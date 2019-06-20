/*
A charging session worker meant to be run as a separate process.
*/
var id = null;
var stopAfter = null;
var timer = null;

process.on('message', function (msg) {
    if (msg.stopAfter) {
        var stopAfterDisplay = msg.stopAfter + 'm';
        if (msg.stopAfter > 60) {
            stopAfterDisplay = (msg.stopAfter / 60).toFixed(1) + ' h';
        }

        if (msg.id) {
            id = msg.id;
            process.send({ message: `Charging worker ${id} is running. Will stop after ${stopAfterDisplay}.` });
        }
        timer = startTimer(msg.stopAfter * 60000, timer);
    }
});

function startTimer(stopAfter, timer) {
    // Clear existing timer if exists
    if (timer) {
        clearTimeout(timer);
    }

    return setTimeout(() => {
        // Stop transaction
        process.send({ stop: true });
    }, stopAfter);
}
