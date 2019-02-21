"use strict";
function isObject(value) {
    return value !== null && typeof value === 'object';
}
// https://tc39.github.io/ecma262/#sec-promisecapability-records
// https://tc39.github.io/ecma262/#sec-newpromisecapability
class PromizeCapability {
    constructor(C) {
        const capability = this;
        // https://tc39.github.io/ecma262/#sec-getcapabilitiesexecutor-functions
        function executor(resolve, reject) {
            capability._resolve = resolve;
            capability._reject = reject;
        }
        executor._capability = this;
        // here is where executor gets called and _resolve and _reject are assigned
        const promise = new C(executor);
        this._promise = promise;
    }
}
// https://tc39.github.io/ecma262/#sec-promisereaction-records
class PromizeReaction {
    constructor(_capability, _handler, _type) {
        this._capability = _capability;
        this._handler = _handler;
        this._type = _type;
    }
}
// https://tc39.github.io/ecma262/#sec-promise-executor
class Promize {
    constructor(executor) {
        this._promiseState = 'pending';
        this._promiseFulfillReactions = [];
        this._promiseRejectReactions = [];
        this._promiseIsHandled = false;
        const resolvingFunctions = createResolvingFunctions(this);
        try {
            executor(resolvingFunctions.resolve, resolvingFunctions.reject);
        }
        catch (completion) {
            resolvingFunctions.reject(completion);
        }
    }
    // https://tc39.github.io/ecma262/#sec-promise.prototype.then
    then(onFulfilled, onRejected) {
        const resultCapability = new PromizeCapability(Promize);
        return performPromiseThen(this, onFulfilled, onRejected, resultCapability);
    }
    // https://tc39.github.io/ecma262/#sec-promise.resolve
    static resolve(value) {
        return promiseResolve(this, value);
    }
}
// https://tc39.github.io/ecma262/#sec-performpromisethen
function performPromiseThen(promise, onFulfilled, onRejected, resultCapability) {
    const fulfillReaction = new PromizeReaction(resultCapability, onFulfilled, 'fulfill');
    const rejectReaction = new PromizeReaction(resultCapability, onRejected, 'reject');
    switch (promise._promiseState) {
        case 'pending':
            promise._promiseFulfillReactions = promise._promiseFulfillReactions || [];
            promise._promiseRejectReactions = promise._promiseRejectReactions || [];
            promise._promiseFulfillReactions.push(fulfillReaction);
            promise._promiseRejectReactions.push(rejectReaction);
            break;
        case 'fulfilled':
            const result = promise._promiseResult;
            enqueueJob('PromiseJobs', promiseReactionJob, [
                fulfillReaction,
                result,
            ]);
            break;
        case 'rejected':
            const reason = promise._promiseResult;
            if (!promise._promiseIsHandled)
                hostPromiseRejectionTracker(promise, 'handle');
            enqueueJob('PromiseJobs', promiseReactionJob, [
                rejectReaction,
                reason,
            ]);
            break;
    }
    promise._promiseIsHandled = true;
    return resultCapability && resultCapability._promise;
}
// https://tc39.github.io/ecma262/#sec-createresolvingfunctions
function createResolvingFunctions(promise) {
    const alreadyResolved = { _value: false };
    // https://tc39.github.io/ecma262/#sec-promise-resolve-functions
    function resolve(resolution) {
        if (alreadyResolved._value)
            return;
        alreadyResolved._value = true;
        // @ts-ignore-next-line
        if (resolution === promise)
            return rejectPromise(promise, new TypeError('Self resolution'));
        if (!isObject(resolution))
            return fulfillPromise(promise, resolution);
        if ('then' in resolution) {
            // TODO: look at step 10
            const thenAction = resolution.then;
            if (typeof thenAction !== 'function')
                return fulfillPromise(promise, resolution);
            const thenable = resolution;
            enqueueJob('PromiseJobs', promiseResolveThenableJob, [promise, thenable, thenable.then]);
        }
    }
    resolve._promise = promise;
    resolve._alreadyResolved = alreadyResolved;
    // https://tc39.github.io/ecma262/#sec-promise-reject-functions
    function reject(reason) {
        if (alreadyResolved._value)
            return;
        alreadyResolved._value = true;
        return rejectPromise(promise, reason);
    }
    reject._promise = promise;
    reject._alreadyResolved = alreadyResolved;
    return { resolve, reject };
}
// https://tc39.github.io/ecma262/#sec-fulfillpromise
function fulfillPromise(promise, value) {
    const reactions = promise._promiseFulfillReactions;
    promise._promiseResult = value;
    promise._promiseFulfillReactions = undefined;
    promise._promiseRejectReactions = undefined;
    promise._promiseState = 'fulfilled';
    return reactions && triggerPromiseReactions(reactions, value);
}
// https://tc39.github.io/ecma262/#sec-rejectpromise
function rejectPromise(promise, reason) {
    const reactions = promise._promiseRejectReactions;
    promise._promiseResult = reason;
    promise._promiseFulfillReactions = undefined;
    promise._promiseRejectReactions = undefined;
    promise._promiseState = 'rejected';
    if (!promise._promiseIsHandled) {
        hostPromiseRejectionTracker(promise, 'reject');
    }
    return reactions && triggerPromiseReactions(reactions, reason);
}
// https://tc39.github.io/ecma262/#sec-promise.resolve
function promiseResolve(C, x) {
    if (isObject(x) && '_promiseState' in x && x.constructor === C)
        return x;
    const promiseCapability = new PromizeCapability(C);
    promiseCapability._resolve(x);
    return promiseCapability._promise;
}
// https://tc39.github.io/ecma262/#sec-host-promise-rejection-tracker
function hostPromiseRejectionTracker(promise, operation) {
    console.error('Uncaught (in promise) ' + promise._promiseResult, operation);
}
// https://tc39.github.io/ecma262/#sec-triggerpromisereactions
function triggerPromiseReactions(reactions, argument) {
    for (let i = 0; i < reactions.length; i++)
        enqueueJob('PromiseJobs', promiseReactionJob, [
            reactions[i],
            argument,
        ]);
}
// https://tc39.github.io/ecma262/#sec-enqueuejob
function enqueueJob(queueName, job, args) {
    // console.info(`Enqueueing job in: ${queueName}`)
    process.nextTick(job, ...args);
}
// https://tc39.github.io/ecma262/#sec-promisereactionjob
function promiseReactionJob(reaction, argument) {
    let shouldReject = false;
    let retVal;
    if (!reaction._handler) {
        retVal = argument;
        shouldReject = reaction._type !== 'fulfill';
    }
    else {
        try {
            retVal = reaction._handler(argument);
            shouldReject = false;
        }
        catch (error) {
            retVal = error;
            shouldReject = true;
        }
    }
    if (!reaction._capability)
        return;
    return shouldReject ? reaction._capability._reject(retVal) : reaction._capability._resolve(retVal);
}
// https://tc39.github.io/ecma262/#sec-promiseresolvethenablejob
function promiseResolveThenableJob(promiseToResolve, thenable, then) {
    const resolvingFunctions = createResolvingFunctions(promiseToResolve);
    try {
        return then.call(thenable, resolvingFunctions.resolve, resolvingFunctions.reject);
    }
    catch (error) {
        return resolvingFunctions.reject(error);
    }
}
// https://tc39.github.io/ecma262/#await
function* Await(value, harmonyOptimizeAwait) {
    let result;
    let promise;
    if (harmonyOptimizeAwait) {
        promise = promiseResolve(Promize, value);
    }
    else {
        const promiseCapability = new PromizeCapability(Promize);
        promiseCapability._resolve(value);
        promise = promiseCapability._promise;
    }
    const throwaway = new PromizeCapability(Promize);
    yield performPromiseThen(promise, resolution => {
        result = resolution;
    }, error => {
        throw error;
    }, throwaway);
    return result;
}
module.exports = { Promize, Await };
