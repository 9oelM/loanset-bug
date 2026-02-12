import xrpl, { signLoanSetByCounterparty } from 'xrpl'
import fs from 'fs'
import { sign } from 'ripple-keypairs'

// ============================================================================
// Helper functions (from xrpl.js counterpartySigner.ts)
// ============================================================================

// ============================================================================
// Main: LoanSet with Single Signing (Following Integration Test Flow)
// ============================================================================

console.log('=== LoanSet: Single Signature Flow (Matching Integration Test) ===\n')

// Load setup data
const setupData: any = JSON.parse(fs.readFileSync('lendingSetup.json', 'utf8'))

const client = new xrpl.Client('wss://s.devnet.rippletest.net:51233')
await client.connect()

// Create wallets from seeds
const loanBrokerWallet = xrpl.Wallet.fromSeed(setupData.loanBroker.seed)
const borrowerWallet = xrpl.Wallet.fromSeed(setupData.borrower.seed)

console.log('Loan Broker:', loanBrokerWallet.address)
console.log('Borrower:', borrowerWallet.address)
console.log()

// ============================================================================
// Broker initiates the Loan
// ============================================================================
console.log('Step 1: Creating and autofilling LoanSet transaction...')

let loanSetTx: any = {
  TransactionType: 'LoanSet',
  Account: loanBrokerWallet.address,
  LoanBrokerID: setupData.loanBrokerID,
  PrincipalRequested: '5000000',
  Counterparty: borrowerWallet.address,
  PaymentTotal: 1,
}

loanSetTx = await client.autofill(loanSetTx)
console.log('✓ Transaction autofilled\n')

// ============================================================================
// Loan broker signs the transaction
// ============================================================================
console.log('Step 2: Loan broker signs the transaction...')

const { tx_blob } = loanBrokerWallet.sign(loanSetTx)
console.log('✓ Loan broker signed')
console.log('  tx_blob length:', tx_blob.length, 'characters\n')

// ============================================================================
// Verify signature (optional but recommended)
// ============================================================================
console.log('Step 3: Verifying loan broker signature...')

const isValid = xrpl.verifySignature(tx_blob)
console.log('✓ Signature valid:', isValid)
if (!isValid) {
  throw new Error('Invalid loan broker signature!')
}
console.log()

// ============================================================================
// Borrower signs with CounterpartySignature
// ============================================================================
console.log('Step 4: Borrower signs with CounterpartySignature...')

const { tx: borrowerSignedTx, tx_blob: borrowerSignedTxBlob, hash: borrowerHash } = signLoanSetByCounterparty(
  borrowerWallet,
  tx_blob,
)
console.log('✓ Borrower counterparty signature created')
console.log('  Structure:', {
  HasMainSignature: !!borrowerSignedTx.TxnSignature,
  HasCounterpartySignature: !!borrowerSignedTx.CounterpartySignature,
  CounterpartyFields: Object.keys(borrowerSignedTx.CounterpartySignature || {})
})
console.log('  Hash:', borrowerHash)
console.log('  tx_blob length:', borrowerSignedTxBlob.length)
console.log('\n  Full transaction:')
console.log(JSON.stringify(borrowerSignedTx, null, 2))
console.log()

// ============================================================================
// Submit the transaction
// ============================================================================
console.log('Step 5: Submitting transaction...')

try {
  const response = await client.submit(borrowerSignedTx)

  console.log('✓ Submit result:', response.result.engine_result)
  console.log('  Transaction hash:', response.result.tx_json.hash)

  if (response.result.engine_result === 'tesSUCCESS') {
    console.log('\n✅ SUCCESS! Transaction accepted by ledger!')

    // Wait for validation
    console.log('\nWaiting for validation...')
    const txHash = response.result.tx_json.hash!

    // Poll for validated transaction
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const tx = await client.request({
          command: 'tx',
          transaction: txHash
        })
        if (tx.result.validated) {
          console.log('✓ Transaction validated!')
          const meta: any = tx.result.meta
          console.log('  Result:', meta.TransactionResult)

          if (meta.TransactionResult === 'tesSUCCESS') {
            // Extract loan ID
            const loanID = meta.AffectedNodes.find((node: any) =>
              node.CreatedNode?.LedgerEntryType === 'Loan'
            )?.CreatedNode.LedgerIndex

            console.log('  Loan ID:', loanID)
          }
          break
        }
      } catch (error) {
        // Transaction not found yet, continue waiting
      }
    }
  } else {
    console.log('\n❌ Transaction not successful:', response.result.engine_result)
    console.log('   Message:', response.result.engine_result_message)
  }
} catch (error) {
  console.error('\n❌ Error submitting transaction:')
  console.error('\nFull error object:')
  console.error(JSON.stringify(error, null, 2))
  console.error('\nError message:', (error as Error).message)
  if ((error as any).data) {
    console.error('\nError data:')
    console.error(JSON.stringify((error as any).data, null, 2))
  }
}

await client.disconnect()
console.log('\n=== Test Complete ===')
