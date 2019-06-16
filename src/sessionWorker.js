/*
A charging session worker meant to be run as a separate process.
*/
var id = null;
var stopAfter = null;
var timer = null;

process.on('message', function (msg) {
    if (msg.stopAfter) {
        if (msg.id) {
            id = msg.id;
            process.send({ message: `Charging worker ${id} is running. Will stop after ${msg.stopAfter} min.` });
        }
        stopAfter = msg.stopAfter * 60000;
        timer = startTimer(stopAfter, timer);
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
