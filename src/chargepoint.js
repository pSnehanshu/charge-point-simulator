const Session = require('./session');

class ChargePoint {
    constructor(serial, uids = []) {
        // Store serial number
        this.serialno = serial;

        // Store the given UIDs
        if (!Array.isArray(uids)) uids = [uids];
        this.uids = shuffle(uids);
    }

    start() {
        
    }
};

module.exports = ChargePoint;


function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
}
