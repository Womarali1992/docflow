/**
 * A worker that never answers, so the timeout in `sniffHead` can be tested
 * without a malformed ASF file.
 *
 * F1 is a *synchronous* loop inside the parser — the thread never yields, so
 * nothing short of terminating it helps. This reproduces that shape exactly:
 * a busy loop, no await, no message. If `worker.terminate()` did not work, this
 * file would hang the test run rather than fail it, which is the honest test.
 */
while (true) {
  // Touch something so no engine can optimize the loop away.
  Math.sqrt(Date.now());
}
