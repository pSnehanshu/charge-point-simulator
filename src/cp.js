const express = require('express');
const csv = require('csv-parse');
const router = express.Router();
module.exports = router;

router.get('/', async function (req, res) {
    res.render('cp', req.cp);
});

router.post('/uid-upload', function (req, res) {
    if (!req.files.uids) {
        return res.sendStatus(400);
    }
    var file = req.files.uids;
    var data = Buffer.from(file.data).toString();

    // Parse the csv
    csv(data, {}, function (err, output) {
        if (err) {
            console.error(error);
            return res.sendStatus(400);
        }
        var uids = transpose(output)[0];
        req.cp.uids = arrayUnique(req.cp.uids.concat(uids));
        res.redirect(`/cp/${req.cp.serialno}`);
    });
});

// Source: https://stackoverflow.com/a/17428705/9990365
function transpose(array = [[]]) {
    return array[0].map((col, i) => array.map(row => row[i]));
}
// Source: https://stackoverflow.com/a/1584377/9990365
function arrayUnique(array) {
    var a = array.concat();
    for (var i = 0; i < a.length; ++i) {
        for (var j = i + 1; j < a.length; ++j) {
            if (a[i] === a[j])
                a.splice(j--, 1);
        }
    }

    return a;
}
