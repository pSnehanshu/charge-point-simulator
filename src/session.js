const shortid = require('shortid');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = shortid.generate();
        this.uid = uid;

        // Params
        this.energy = params.energy || 5;// in kWh (randomly between 5 to 60)
        this.power = params.power || 5.6; // in kW (randomly between 3.7 and 11)
        this.duration = this.energy * 60 / this.power; // in minutes
        this.start = params.start || new Date;

        // setTimeout timer for this session
        this.timer = null;
    }

    // Time elapsed in minutes
    get elapsed() {
        var now = new Date;
        var elapsed = this.start - now;
        return elapsed / 60000;
    }

    _finishTask() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        var timeLeft = this.duration - this.elapsed;
        this.timer = setTimeout(() => {
            // StopTransaction
            console.log('Stop transaction');
        }, timeLeft * 60000);
    }
};

module.exports = Session;
