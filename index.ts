type PromizeReactionType = 'fulfill' | 'reject'
type PromizeState = 'pending' | 'rejected' | 'fulfilled'

function isObject(value: any): boolean {
  return value !== null && typeof value === 'object'
}

// https://tc39.github.io/ecma262/#sec-promise-executor
class Promize<T, E> {
  _promiseState: PromizeState = 'pending'
  _promiseResult!: T | E
  _promiseFulfillReactions: PromizeReaction<T>[] | undefined = []
  _promiseRejectReactions: PromizeReaction<E>[] | undefined = []
  _promiseIsHandled: boolean = false

  constructor(executor: (resolve: (value: T) => void, reject: (reason: E) => void) => void) {
    const resolvingFunctions = createResolvingFunctions(this)
    try {
      executor(resolvingFunctions.resolve, resolvingFunctions.reject)
    } catch (completion) {
      resolvingFunctions.reject(completion)
    }
  }

  // https://tc39.github.io/ecma262/#sec-promise.prototype.then
  then(onFulfilled: (resolution: T) => void, onRejected: (reason: E) => void): any {
    const resultCapability = new PromizeCapability<T, E>(Promize)
    return performPromiseThen(this, onFulfilled, onRejected, resultCapability)
  }

  // https://tc39.github.io/ecma262/#sec-promise.resolve
  static resolve<T>(value: T) {
    return promiseResolve(this, value)
  }
}

// https://tc39.github.io/ecma262/#sec-promisecapability-records
// https://tc39.github.io/ecma262/#sec-newpromisecapability
class PromizeCapability<T, E> {
  _promise: Promize<T, E>
  _resolve!: (value: T) => any
  _reject!: (reason: E) => any

  constructor(C: typeof Promize) {
    const capability = this
    // https://tc39.github.io/ecma262/#sec-getcapabilitiesexecutor-functions
    function executor(resolve: typeof capability._resolve, reject: typeof capability._reject) {
      capability._resolve = resolve
      capability._reject = reject
    }
    executor._capability = this
    // here is where executor gets called and _resolve and _reject are assigned
    const promise = new C(executor)
    this._promise = promise
  }
}

// https://tc39.github.io/ecma262/#sec-promisereaction-records
class PromizeReaction<T> {
  constructor(
    public _capability: PromizeCapability<T, any> | PromizeCapability<any, T> | undefined,
    public _handler: ((value: T) => any) | undefined,
    public _type: PromizeReactionType
  ) {}
}

// https://tc39.github.io/ecma262/#sec-performpromisethen
function performPromiseThen<T, E>(
  promise: Promize<T, E>,
  onFulfilled: (resolution: T) => void,
  onRejected: (reason: E) => void,
  resultCapability?: PromizeCapability<T, E>
) {
  const fulfillReaction = new PromizeReaction<T>(resultCapability, onFulfilled, 'fulfill')
  const rejectReaction = new PromizeReaction<E>(resultCapability, onRejected, 'reject')
  switch (promise._promiseState) {
    case 'pending':
      promise._promiseFulfillReactions = promise._promiseFulfillReactions || []
      promise._promiseRejectReactions = promise._promiseRejectReactions || []
      promise._promiseFulfillReactions.push(fulfillReaction)
      promise._promiseRejectReactions.push(rejectReaction)
      break
    case 'fulfilled':
      const result = promise._promiseResult as T
      enqueueJob<[typeof fulfillReaction, typeof result]>('PromiseJobs', promiseReactionJob, [
        fulfillReaction,
        result,
      ])
      break
    case 'rejected':
      const reason = promise._promiseResult as E
      if (!promise._promiseIsHandled) hostPromiseRejectionTracker(promise, 'handle')
      enqueueJob<[typeof rejectReaction, typeof reason]>('PromiseJobs', promiseReactionJob, [
        rejectReaction,
        reason,
      ])
      break
  }
  promise._promiseIsHandled = true
  return resultCapability && resultCapability._promise
}

// https://tc39.github.io/ecma262/#sec-createresolvingfunctions
function createResolvingFunctions<T, E>(promise: Promize<T, E>) {
  const alreadyResolved = { _value: false }
  // https://tc39.github.io/ecma262/#sec-promise-resolve-functions
  function resolve(resolution: T) {
    if (alreadyResolved._value) return
    alreadyResolved._value = true
    // @ts-ignore-next-line
    if (resolution === promise) return rejectPromise(promise, new TypeError('Self resolution'))
    if (!isObject(resolution)) return fulfillPromise(promise, resolution)
    if ('then' in resolution) {
      // TODO: look at step 10
      const thenAction = (resolution as any).then
      if (typeof thenAction !== 'function') return fulfillPromise(promise, resolution)
      const thenable = (resolution as any) as Promize<any, any>
      enqueueJob<[typeof promise, typeof thenable, typeof thenable.then]>(
        'PromiseJobs',
        promiseResolveThenableJob,
        [promise, thenable, thenable.then]
      )
    }
  }
  resolve._promise = promise
  resolve._alreadyResolved = alreadyResolved
  // https://tc39.github.io/ecma262/#sec-promise-reject-functions
  function reject(reason: E) {
    if (alreadyResolved._value) return
    alreadyResolved._value = true
    return rejectPromise(promise, reason)
  }
  reject._promise = promise
  reject._alreadyResolved = alreadyResolved
  return { resolve, reject }
}

// https://tc39.github.io/ecma262/#sec-fulfillpromise
function fulfillPromise<T>(promise: Promize<T, any>, value: T) {
  const reactions = promise._promiseFulfillReactions
  promise._promiseResult = value
  promise._promiseFulfillReactions = undefined
  promise._promiseRejectReactions = undefined
  promise._promiseState = 'fulfilled'
  return reactions && triggerPromiseReactions(reactions, value)
}

// https://tc39.github.io/ecma262/#sec-rejectpromise
function rejectPromise<E>(promise: Promize<any, E>, reason: E) {
  const reactions = promise._promiseRejectReactions
  promise._promiseResult = reason
  promise._promiseFulfillReactions = undefined
  promise._promiseRejectReactions = undefined
  promise._promiseState = 'rejected'
  if (!promise._promiseIsHandled) {
    hostPromiseRejectionTracker(promise, 'reject')
  }
  return reactions && triggerPromiseReactions(reactions, reason)
}

// https://tc39.github.io/ecma262/#sec-promise.resolve
function promiseResolve(C: any, x: any) {
  if (isObject(x) && '_promiseState' in x && x.constructor === C) return x
  const promiseCapability = new PromizeCapability(C)
  promiseCapability._resolve(x)
  return promiseCapability._promise
}

// https://tc39.github.io/ecma262/#sec-host-promise-rejection-tracker
function hostPromiseRejectionTracker<E>(promise: Promize<any, E>, operation: 'reject' | 'handle') {
  console.error('Uncaught (in promise) ' + promise._promiseResult, operation)
}

// https://tc39.github.io/ecma262/#sec-triggerpromisereactions
function triggerPromiseReactions<T>(reactions: PromizeReaction<T>[], argument: T) {
  for (let i = 0; i < reactions.length; i++)
    enqueueJob<[typeof reactions[number], typeof argument]>('PromiseJobs', promiseReactionJob, [
      reactions[i],
      argument,
    ])
}

// https://tc39.github.io/ecma262/#sec-enqueuejob
function enqueueJob<A extends any[]>(queueName: string, job: (...args: A) => void, args: A) {
  // console.info(`Enqueueing job in: ${queueName}`)
  process.nextTick(job, ...args)
}

// https://tc39.github.io/ecma262/#sec-promisereactionjob
function promiseReactionJob<T>(reaction: PromizeReaction<T>, argument: T) {
  let shouldReject = false
  let retVal
  if (!reaction._handler) {
    retVal = argument
    shouldReject = reaction._type !== 'fulfill'
  } else {
    try {
      retVal = reaction._handler(argument)
      shouldReject = false
    } catch (error) {
      retVal = error
      shouldReject = true
    }
  }

  if (!reaction._capability) return
  return shouldReject ? reaction._capability._reject(retVal) : reaction._capability._resolve(retVal)
}

// https://tc39.github.io/ecma262/#sec-promiseresolvethenablejob
function promiseResolveThenableJob<P extends Promize<any, any>>(
  promiseToResolve: Promize<any, any>,
  thenable: P,
  then: P['then']
) {
  const resolvingFunctions = createResolvingFunctions(promiseToResolve)
  try {
    return then.call(thenable, resolvingFunctions.resolve, resolvingFunctions.reject)
  } catch (error) {
    return resolvingFunctions.reject(error)
  }
}

// https://tc39.github.io/ecma262/#await
function* Await<T>(value: T, harmonyOptimizeAwait?: boolean) {
  let result!: T
  let promise: Promize<T, any>
  if (harmonyOptimizeAwait) {
    promise = promiseResolve(Promize, value)
  } else {
    const promiseCapability = new PromizeCapability<T, any>(Promize)
    promiseCapability._resolve(value)
    promise = promiseCapability._promise
  }
  const throwaway = new PromizeCapability<any, any>(Promize)
  yield performPromiseThen<T, any>(
    promise,
    resolution => {
      result = resolution
    },
    error => {
      throw error
    },
    throwaway
  )
  return result
}

export = { Promize, Await }
