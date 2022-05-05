
const _ = require("lodash");
const SHA256 = require("crypto-js/sha256");
const crypto = require("crypto");


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
    console.log({crypto})
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
    const newBlockHash = this.addNewBlock(new BlockTransaction(
      [], [new TxtOutput(address, amount)]
    ))
    console.log(this.blockchain)
    this.unspendTxtOut[address] = [
      ...this.unspentTransactions(address),
      new UnspendOutBlock(newBlockHash, 0, amount)
    ];
  }

  transactionHistory(address) {
    return _(this.blockchain).filter(block => _.some(block.txOuts, ous => ous.address === address)).sortBy('timestamp').value()
  }

  transfer(fromAddress, toAddress, amount, privateKey) {
    if (fromAddress === toAddress){
      return
    }
    const unspendOutTxt = this.unspentTransactions(fromAddress);
    const totalUnspendAmount = _.sum(_.map(unspendOutTxt, 'amount'))

    if (totalUnspendAmount < amount){
      console.log('Not enough')
      return false
    }
    const inputTxts = _.map(unspendOutTxt, (unspendOutBlock) => {
      const signature = signData(privateKey, unspendOutBlock.outTxtId);
      return new TxtInput(unspendOutBlock.outTxtId, unspendOutBlock.outTxtIndex, signature)
    });
    const outputTxts = [new TxtOutput(toAddress, amount)];
    const remainAmount = totalUnspendAmount - amount;

    if (remainAmount > 0.) {
      outputTxts.push(new TxtOutput(fromAddress, remainAmount));
    }
    const newBlockHash = this.addNewBlock(
      new BlockTransaction(
        inputTxts, outputTxts
      )
    );
    console.log(newBlockHash);

    this.unspendTxtOut[toAddress] = [
      ...this.unspentTransactions(toAddress),
      new UnspendOutBlock(newBlockHash, 0, amount)
    ];
    if (remainAmount > 0.) {
      this.unspendTxtOut[fromAddress] = [new UnspendOutBlock(newBlockHash, 1, remainAmount)]
    }
    console.log('Transfer success')
  }

  unspentTransactions(address) {
    return this.unspendTxtOut[address] || []
  }

  addNewBlock(newBlock) {
    newBlock.precedingHash = this.obtainLatestBlock().hash;
    newBlock.proofOfWork(this.difficulty);
    console.log({newBlock})
    this.blockchain.push(newBlock);
    return newBlock.hash
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

let blockchain = new CryptoBlockchain();

const {publicKey, privateKey} = blockchain.initWallet();



blockchain.initFund(publicKey, 20);

blockchain.transfer(
  publicKey,
  '0xdefg',
  2,
  privateKey
);

const prompt = require("prompt-sync")({ sigint: true });
const age = prompt("How old are you? ");
console.log(`You are ${age} years old.`);

// export default blockchain
