const functions = require("firebase-functions");
const fetch = require("node-fetch");
const admin = require("firebase-admin");
const common = require('../common')

exports.setupMiner = functions.https.onRequest(async (req, res) => {
    const validateResult = await validateMinerSetup(req.params.miner, req.query.hashRate);
    if (validateResult.isError) {
        res.status(400).send(validateResult.error);
        return;
    }

    const result = await setupMiner(validateResult.miner, validateResult.hashRate);
    res.json(result);
});

async function validateMinerSetup(miner, hashRate) {
    const result = {};
    if (!miner.startsWith("0x")) {
        miner = "0x" + miner;
    }

    const isAddress = common.web3.utils.isAddress(miner);
    if (!isAddress) {
        result.isError = true;
        result.error = "Not a valid ETH address: " + miner;
        return result;
    }

    const minerExistsResult = await common.isMinerExists(miner);
    if (minerExistsResult) {
        result.isError = true;
        result.error = miner + " already has been added";
        return result;
    }

    if (!hashRate) {
        result.isError = true;
        result.error = "Provide hashRate for setup {url}?hashRate=300";
        return result;
    }

    result.isError = false;
    result.hashRate = hashRate;
    result.miner = miner;
    return result;
}

async function setupMiner(miner, hashRate) {
    const minerUrl = 'https://api.ethermine.org/miner/' + miner + '/dashboard';
    const json = await fetch(minerUrl, {method: "Get"}).then(response => response.json());

    const data = {
        average: averageHashes(json),
        unpaid: minedEth(json),
        date: admin.firestore.Timestamp.fromDate(new Date()),
        diff: 0
    };
    await common.db.collection('miners').doc(miner).set(
        {
            hashRate: parseInt(hashRate),
            enabled: true
        }
    );
    await common.db.collection('miners').doc(miner).collection('unpaidDaily').add(data);
    return data;
}