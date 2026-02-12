import xrpl from 'xrpl'
import fs from 'fs'

// Example: Local signing of LoanSet transactions with wallet.sign
// Demonstrates multi-party signing where both parties sign locally

console.log('=== Local LoanSet Signing Example ===\n')

// Load setup data
const setupData = JSON.parse(fs.readFileSync('lendingSetup.json', 'utf8'))

const client = new xrpl.Client('wss://s.devnet.rippletest.net:51233')
await client.connect()

// Create wallets from seeds
const loanBroker = xrpl.Wallet.fromSeed(setupData.loanBroker.seed)
const borrower = xrpl.Wallet.fromSeed(setupData.borrower.seed)

console.log('Loan Broker:', loanBroker.address)
console.log('Borrower:', borrower.address)
console.log()

// Suppress unnecessary console warning from autofilling LoanSet
console.warn = () => {}

// ============================================================================
// STEP 1: Create unsigned transaction
// ============================================================================
console.log('STEP 1: Creating unsigned LoanSet transaction...\n')

const unsignedTx = await client.autofill({
  TransactionType: 'LoanSet',
  Account: loanBroker.address,
  Counterparty: borrower.address,
  LoanBrokerID: setupData.loanBrokerID,
  PrincipalRequested: '1500',
  InterestRate: 600,
  PaymentTotal: 12,
  PaymentInterval: 2592000,
  GracePeriod: 604800,
  LoanOriginationFee: '150',
  LoanServiceFee: '15'
})

console.log('Unsigned transaction created:')
console.log(JSON.stringify(unsignedTx, null, 2))
console.log()

// ============================================================================
// STEP 2: Sign with wallet.sign() - Loan Broker (first party)
// ============================================================================
console.log('STEP 2: Signing with loan broker wallet.sign()...\n')

const loanBrokerSigned = loanBroker.sign(unsignedTx)

// Decode the blob to get the full signed transaction with signatures
const loanBrokerSignedTx = xrpl.decode(loanBrokerSigned.tx_blob)

console.log('Loan broker signature:')
console.log('  Hash:', loanBrokerSigned.hash)
console.log('  TxnSignature:', loanBrokerSignedTx.TxnSignature.substring(0, 20) + '...')
console.log('  SigningPubKey:', loanBrokerSignedTx.SigningPubKey)
console.log()

// ============================================================================
// STEP 3: Sign with wallet.sign() as Counterparty - Borrower (second party)
// ============================================================================
console.log('STEP 3: Signing with borrower wallet.sign() as Counterparty...\n')

// For CounterpartySignature, sign the transaction WITHOUT the main signature
// Import low-level signing functions
import { sign } from 'ripple-keypairs'
import { encodeForSigning } from 'ripple-binary-codec'

// Prepare the transaction for signing (REMOVE the loan broker's signature)
const txForCounterpartySigning = { ...loanBrokerSignedTx }
delete txForCounterpartySigning.TxnSignature
delete txForCounterpartySigning.SigningPubKey

// Encode the transaction for signing (this creates the hash that needs to be signed)
const signingHash = encodeForSigning(txForCounterpartySigning)

console.log('Signing hash:', signingHash.substring(0, 20) + '...')

// Sign the hash with the borrower's private key
const borrowerTxnSignature = sign(signingHash, borrower.privateKey)
const borrowerSigningPubKey = borrower.publicKey

console.log('Borrower counterparty signature created:')
console.log('  TxnSignature:', borrowerTxnSignature.substring(0, 20) + '...')
console.log('  SigningPubKey:', borrowerSigningPubKey)
console.log()

// ============================================================================
// STEP 4: Combine both signatures into CounterpartySignature structure
// ============================================================================
console.log('STEP 4: Combining both signatures...\n')

// Manually construct the final transaction with both signatures
const finalTx = {
  ...loanBrokerSignedTx,  // Includes the loan broker's TxnSignature and SigningPubKey
  CounterpartySignature: {
    TxnSignature: borrowerTxnSignature,
    SigningPubKey: borrowerSigningPubKey
  }
}

console.log('Final transaction structure:')
console.log('  Has TxnSignature:', !!finalTx.TxnSignature)
console.log('  Has SigningPubKey:', !!finalTx.SigningPubKey)
console.log('  Has CounterpartySignature:', !!finalTx.CounterpartySignature)
console.log()

// Validate the transaction structure
xrpl.validate(finalTx)
console.log('✓ Transaction validation passed')
console.log()

// Encode for submission
const finalTxBlob = xrpl.encode(finalTx)
console.log('Encoded transaction blob length:', finalTxBlob.length)
console.log()

// ============================================================================
// STEP 5: Submit the fully signed transaction
// ============================================================================
console.log('STEP 5: Submitting transaction...\n')

const submitResponse = await client.submit(finalTxBlob)

console.log('Submit result:', submitResponse.result.engine_result)
console.log('Transaction hash:', submitResponse.result.tx_json.hash)
console.log()

// Wait for validation
console.log('Waiting for validation...')

async function waitForValidation(hash, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    try {
      const tx = await client.request({ command: 'tx', transaction: hash })
      if (tx.result.validated) {
        return tx
      }
    } catch (error) {
      // Transaction not validated yet, continue waiting
    }
  }
  throw new Error(`Transaction ${hash} not validated after ${maxRetries} attempts`)
}

const validatedTx = await waitForValidation(submitResponse.result.tx_json.hash)

if (validatedTx.result.meta.TransactionResult !== 'tesSUCCESS') {
  console.error('Error: Transaction failed:', validatedTx.result.meta.TransactionResult)
  await client.disconnect()
  process.exit(1)
}

console.log('✓ Transaction validated successfully!')
console.log('Result:', validatedTx.result.meta.TransactionResult)

const loanID = validatedTx.result.meta.AffectedNodes.find(node =>
  node.CreatedNode?.LedgerEntryType === 'Loan'
).CreatedNode.LedgerIndex

console.log('New Loan ID:', loanID)
console.log()
console.log('✅ Successfully created loan using local wallet.sign() for both signatures!')

await client.disconnect()
