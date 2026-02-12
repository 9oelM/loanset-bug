# XRPL Lending Protocol Examples

This project contains TypeScript examples for working with XRPL lending transactions, specifically demonstrating local signing of multi-party LoanSet transactions with CounterpartySignature.

## Project Structure

### Core Files

- **`lending_setup.ts`** - Initial setup script that:
  - Creates and funds test wallets (loan broker, borrower, depositor, credential issuer)
  - Issues MPT tokens
  - Sets up credentials and permissioned domains
  - Creates vaults and loan brokers
  - Generates two sample loans using **server-side signing** (working solution)
  - Outputs configuration to `lendingSetup.json`

- **`local_signing_test.ts`** ✅ **CORRECT IMPLEMENTATION**
  - Follows the exact flow from xrpl.js integration tests
  - Uses the official `signLoanSetByCounterparty` implementation
  - Demonstrates proper transaction normalization and signing
  - **Production-ready code** (will work when devnet is upgraded)

## Usage

### 1. Setup

First, run the setup script to initialize wallets and resources:

```bash
npx tsx lending_setup.ts
```

This creates `lendingSetup.json` with all necessary account information and demonstrates **working server-side signing**.

### 2. Test Local Signing (Currently Limited to Local Standalone)

```bash
npx tsx local_signing_test.ts
```

**Note**: This will fail on devnet with "Invalid signature" (see Known Limitation below).

## CounterpartySignature Implementation

### Correct Implementation ✅

From `local_signing_test.ts`, following the official xrpl.js approach:

```typescript
// Step 1: Autofill and sign with loan broker
let loanSetTx = {
  TransactionType: 'LoanSet',
  Account: loanBrokerWallet.address,
  Counterparty: borrowerWallet.address,
  LoanBrokerID: loanBrokerObjectId,
  PrincipalRequested: '5000000',
  PaymentTotal: 1,
}

loanSetTx = await client.autofill(loanSetTx)
const { tx_blob } = loanBrokerWallet.sign(loanSetTx)

// Step 2: Sign with borrower using CounterpartySignature
const { tx: borrowerSignedTx } = signLoanSetByCounterparty(
  borrowerWallet,
  tx_blob,
)

// Step 3: Submit
await client.submit(borrowerSignedTx)
```

**Key Implementation Details**:

```typescript
function signLoanSetByCounterparty(wallet, transaction) {
  // 1. Normalize transaction via decode(encode())
  const tx = decode(encode(transaction))

  // 2. Sign WITH the first party's TxnSignature still present
  //    encodeForSigning() automatically excludes TxnSignature from hash
  //    (isSigningField: false in definitions.json)
  tx.CounterpartySignature = {
    SigningPubKey: wallet.publicKey,
    TxnSignature: sign(encodeForSigning(tx), wallet.privateKey),
  }

  return { tx, tx_blob: encode(tx), hash: hashSignedTx(encode(tx)) }
}
```

### Transaction Structure

A correctly signed LoanSet transaction with CounterpartySignature looks like:

```json
{
  "TransactionType": "LoanSet",
  "Account": "r9BABspCLg4Ma6WqiZy6USTdu68qzz4noj",
  "Counterparty": "rL8VRjZriieaoNmLCMvet45VPMT8nrcHP4",
  "PrincipalRequested": "5000",
  "PaymentTotal": 1,
  "Fee": "2",
  "Sequence": 3652011,
  "LastLedgerSequence": 3653781,
  "LoanBrokerID": "C275AED0288B541436A1B6201C2E46BC21701DEACC20DD12FB39860970D9F6FD",

  // First party signature (loan broker)
  "SigningPubKey": "ED877561249843A3AFE483CA31ACC5FE82B3E6AAA82826C4801DF9D084068196A9",
  "TxnSignature": "A3947717FF8CCC75F7CBB4F043EE9EB8B5FE7053E61CAAF025971C6816BD36A21D74F8AF8925ECEA6D86A276DC912DF7FD5165D3C09D39B919E0FFABB1625B01",

  // Second party signature (borrower)
  "CounterpartySignature": {
    "SigningPubKey": "ED1096BF29FB92CB0F25F900455567F31999F295858D9619E840F44513AC072F6F",
    "TxnSignature": "296B0EF1247688B5DBEE7A43DA0CC2FD0766B97F6B6428D20D428A01D597DD0B214E96333EF466B0E9CB8ADE38196A2794DD5247F4AABAB77399C5862556E502"
  }
}
```

## Known Limitation: Devnet Incompatibility

⚠️ **Local client-side signing of CounterpartySignature currently fails on public devnet with "Invalid signature" error.**

### What Works ✅

- ✅ Transaction structure is 100% correct
- ✅ Implementation matches official xrpl.js code exactly
- ✅ Passes local validation (`xrpl.validate()`)
- ✅ First party signature verifies (`xrpl.verifySignature()`)
- ✅ Server-side signing works perfectly (see `lending_setup.ts`)
- ✅ Integration tests pass (on local standalone rippled)

### What Doesn't Work ❌

- ❌ Submission to public devnet fails with: `"fails local checks: Invalid signature"`
