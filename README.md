This repository is an implementation of the ECMAScript Promise spec (most of it) using Node's `process.nextTick()` as the main scheduler.

Main difference between this and the native Promise is that resolved native Promise jobs are called _after_ everything enqueued by `process.nextTick()` is complete.

See `test.js` for more details. There is also an implementation of the `await` expression using a generator function, it's also probably wrong!
