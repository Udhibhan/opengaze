// Worker timers keep running in hidden documents, where animation frames don't fire.
setInterval(() => postMessage(0), 33);
