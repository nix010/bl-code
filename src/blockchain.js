
const _ = require("lodash");
const SHA256 = require("crypto-js/sha256");
const crypto = require("crypto");
const prompt = require("prompt-sync")({ sigint: true });


const signData = (privateKey, data) => {
  var buf1 = Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex'); // specific byte-sequence for curve prime256v1
  var buf2 = Buffer.from(privateKey, 'hex'); // raw private key (32 bytes)
  var privateKeyPkcs8Der = Buffer.concat([buf1, buf2], buf1.length + buf2.length);
  var sign = crypto.createSign('SHA256');
  sign.write(data);
  sign.end();
  return sign.sign({ key: privateKeyPkcs8Der, format: 'der', type: 'pkcs8' }, 'hex');
};

class TxtInput {
  constructor(txOutputId, txOutputIndex, signature=null) {
    this.txOutputId = txOutputId;
    this.txOutputIndex = txOutputIndex;
    this.signature = signature;
  }
}

class TxtOutput {
  constructor(address, amount) {
    this.address = address; //Public key address
    this.amount = amount;
  }
}

class BlockTransaction {
  constructor(inputs, outputs, precedingHash = null) {
    this.txIns = inputs;
    this.txOuts = outputs;

    this.hash = '';

    this.precedingHash = precedingHash;
    this.id = this.computeId();
    this.timestamp = new Date();
    this.nonce = 0;
  }

  proofOfWork(difficulty) {
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")
      ) {
      this.nonce++;
      this.hash = this.computeHash();
    }
  }
  computeHash(){
    return SHA256(this.id + this.precedingHash + this.timestamp + this.nonce).toString();
  }

  computeId(){
    const txInPayload = _(this.txIns).map(txIn => txIn.txOutputId + txIn.txOutputIndex).sum()
    const txOutPayload = _(this.txOuts).map(txOut => txOut.address + txOut.amount).sum()
    return SHA256(txInPayload + txOutPayload).toString();
  }

}

class UnspendOutBlock {
  constructor(outTxtId, outTxtIndex, amount) {
    this.outTxtId = outTxtId
    this.outTxtIndex = outTxtIndex
    this.amount = amount
  }
}


class CryptoBlockchain {
  constructor() {
    const genesisBlock = new BlockTransaction();
    genesisBlock.hash = genesisBlock.computeHash();
    this.blockchain = [genesisBlock];
    this.difficulty = 4;
    this.unspendTxtOut = {};
  }

  initWallet(){
    const ec = crypto.generateKeyPairSync('ec', {
      namedCurve: 'sect239k1',
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'der'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'der'
      }
    });
    return {
      publicKey : ec.publicKey.toString('hex'),
      privateKey : ec.privateKey.toString('hex'),
    }
  }

  obtainLatestBlock() {
    return this.blockchain[this.blockchain.length - 1];
  }

  initFund(address, amount) {
    const newBlockId = this.addNewBlock(new BlockTransaction(
      [], [new TxtOutput(address, amount)]
    ))
    this.unspendTxtOut[address] = [
      ...this.unspentTransactions(address),
      new UnspendOutBlock(newBlockId, 0, amount)
    ];
  }

  unspentAmount(address) {
    const unspendOutTxt = this.unspentTransactions(address);
    const totalUnspendAmount = _.sum(_.map(unspendOutTxt, 'amount'))
    return totalUnspendAmount
  }

  transactionHistoryReadable(address) {
    const transactions = this.transactionHistory(address);
    if (!transactions.length){
      console.log('No transaction data');
      return
    }
    transactions.map(tran => {
      const movingIn = tran.txOuts[0].address === address;
      const move = movingIn ? 'Received fund': 'Transfer fund';
      console.log(`${move} amount: ${tran.txOuts[0].amount} - (at ${tran.timestamp})` )
    })
  }

  transactionHistory(address) {
    const outIds = _(this.blockchain)
      .filter(block => _.some(block.txOuts, ous => ous.address === address))
      .map(block => block.id).value();
    return _(this.blockchain).filter(block =>
      _.some(block.txIns, ins => outIds.includes(ins.txOutputId)) ||
      _.some(block.txOuts, ous => ous.address === address)
    ).sortBy('timestamp').value()
  }

  transfer(fromAddress, toAddress, amount, privateKey) {
    if (fromAddress === toAddress){
      console.log('Duplicated addresses')
      return
    }
    const totalUnspendAmount = this.unspentAmount(fromAddress);
    if (totalUnspendAmount < amount){
      console.log('Not enough fund')
      return false
    }
    const unspendOutTxt = this.unspentTransactions(fromAddress);
    const inputTxts = _.map(unspendOutTxt, (unspendOutBlock) => {
      const signature = signData(privateKey, unspendOutBlock.outTxtId);
      return new TxtInput(unspendOutBlock.outTxtId, unspendOutBlock.outTxtIndex, signature)
    });
    const outputTxts = [new TxtOutput(toAddress, amount)];
    const remainAmount = totalUnspendAmount - amount;

    if (remainAmount > 0.) {
      outputTxts.push(new TxtOutput(fromAddress, remainAmount));
    }
    const newBlockId = this.addNewBlock(
      new BlockTransaction(
        inputTxts, outputTxts
      )
    );
    this.unspendTxtOut[toAddress] = [
      ...this.unspentTransactions(toAddress),
      new UnspendOutBlock(newBlockId, 0, amount)
    ];
    if (remainAmount > 0.) {
      this.unspendTxtOut[fromAddress] = [new UnspendOutBlock(newBlockId, 1, remainAmount)]
    }
    console.log('Transfer success')
  }

  unspentTransactions(address) {
    return this.unspendTxtOut[address] || []
  }

  addNewBlock(newBlock) {
    newBlock.precedingHash = this.obtainLatestBlock().hash;
    newBlock.proofOfWork(this.difficulty);
    this.blockchain.push(newBlock);
    return newBlock.id
  }

  checkChainValidity() {
    for (let i = 1; i < this.blockchain.length; i++) {
      const currentBlock = this.blockchain[i];
      const precedingBlock = this.blockchain[i - 1];

      if (currentBlock.hash !== currentBlock.computeHash()) {
        return false;
      }
      if (currentBlock.precedingHash !== precedingBlock.hash) return false;
    }
    return true;
  }
}

function complete(commands) {
  return function (str) {
    var i;
    var ret = [];
    for (i=0; i< commands.length; i++) {
      if (commands[i].indexOf(str) == 0)
        ret.push(commands[i]);
    }
    return ret;
  };
};

_store = {
  userKey: {},
};

console.clear();
console.log('Start to new blockchain.')

const blockchain = new CryptoBlockchain();
const wallet = blockchain.initWallet();
_store.userKey = wallet;


while (1){
  console.log(`Your wallet is: ${_store.userKey.publicKey}`);
  console.log(`Your amount is: ${blockchain.unspentAmount(_store.userKey.publicKey)}`);
  console.log('----------------------------');
  console.log('1.Create a new wallet');
  console.log('2.Add fund to your wallet');
  console.log('3.Transfer amount to another wallet');
  console.log('4.Check your transfer history');
  console.log('5.Check another wallet transfer history');
  const select = prompt('custom autocomplete: ', {
    autocomplete: complete(['1', '2', '3', '4'])
  });
  const selection = {
    '1': () => {
      const newWallet = blockchain.initWallet();
      console.log(`New wallet is ${newWallet.publicKey}`);
    },
    '2': () => {
      blockchain.initFund(_store.userKey.publicKey, 20);
      console.log(`Fund added in your wallet`);
    },
    '3': () => {
      const toAddress = prompt('To address: ');
      const amount = prompt('Amount: ');
      console.log(`Transferring...`);
      blockchain.transfer(_store.userKey.publicKey, toAddress, amount, _store.userKey.privateKey);
    },
    '4': () => {
      blockchain.transactionHistoryReadable(_store.userKey.publicKey);
    },
    '5': () => {
      const address = prompt('Address: ');
      blockchain.transactionHistoryReadable(address);
    }
  }[select];
  if (!!select)
    selection();
  else if (select === '6'){
    prompt('Exiting.');
    return
  }
  prompt('Continue.');
  console.clear();
}




