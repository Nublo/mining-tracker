const functions = require("firebase-functions");
const common = require('../common')
const providers = require('../providers')

exports.setupMiner = functions.https.onRequest(async (req, res) => {
    const validateResult = await validateMinerSetup(req.params.miner, req.query.hashRate, req.query.provider);
    if (validateResult.isError) {
        res.status(400).send(validateResult.error);
        return;
    }

    const result = await setupMiner(validateResult.miner, validateResult.hashRate, validateResult.provider);
    res.json(result);
});

async function validateMinerSetup(miner, hashRate, provider) {
    const result = {};
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

    switch (provider) {
        case providers.providers.ETHERMINE:
            break;
        case providers.providers.HIVEON:
            break;
        default:
            result.isError = true;
            result.error = "Provide existing provider for setup {url}?provider="
            return result;
    }

    result.isError = false;
    result.hashRate = hashRate;
    result.miner = miner;
    result.provider = provider;
    return result;
}

async function setupMiner(miner, hashRate, provider) {
    const data = await providers.getMinerData(miner, provider, 0, true)
    await common.db.collection('miners').doc(miner).set(
        {
            hashRate: parseInt(hashRate),
            enabled: true,
            provider: provider,
            lastUpdate: providers.admin.firestore.Timestamp.fromDate(new Date())
        }
    );
    await common.db.collection('miners').doc(miner).collection('unpaidDaily').add(data);
    return data;
}