const { Promize, Await } = require('./index.js')

function log(val) {
  console.log(val)
}

new Promise(resolve => {
  resolve(Promise.resolve('dd'))
}).then(log)
new Promise(resolve => {
  console.log('aa')
  resolve('bb')
}).then(log)
Promise.resolve('cc').then(log)

// this uses nextTick, which always comes before the resolved promise queue
// so not a complete recreation
new Promize(resolve => {
  resolve(Promize.resolve('d'))
}).then(log)
new Promize(resolve => {
  console.log('a')
  resolve('b')
}).then(log)
Promize.resolve('c').then(log)

// output
// a
// aa
// b
// c
// d
// bb
// cc
// dd

new Promize((resolve, reject) => {
  const w = Await(Promize.resolve('async promise, unoptimized'))
  const w_0 = w.next()
  w_0.value.then(() => {
    const w_1 = w.next()
    if (!w_1.done) reject('what')
    resolve(w_1.value)
  })
}).then(log)

new Promize((resolve, reject) => {
  const w = Await(Promize.resolve('async promise, optimized'), true)
  const w_0 = w.next()
  w_0.value.then(() => {
    const w_1 = w.next()
    if (!w_1.done) reject('what')
    resolve(w_1.value)
  })
}).then(log)

new Promize((resolve, reject) => {
  const w = Await('async primitive')
  const w_0 = w.next()
  w_0.value.then(() => {
    const w_1 = w.next()
    if (!w_1.done) reject('what')
    resolve(w_1.value)
  })
}).then(log)

// output
// async promise, optimized
// async primitive
// async promise, unoptimized
