# Payments: a first run by hand

A script for trying the payment screens as a person would. It covers what the automated flows cannot show: how things
look and feel. Allow about 40 minutes. Use one browser signed in as an owner and a second, private window signed in as a
member.

For each step, note what you saw if it was not what is written. A screenshot helps most.

## Before you start

- An organisation with a customer and a supplier, both in euros, and an active euro bank account.
- The four payment types on the Transactions menu: `SRC` customer receipt, `PPY` supplier payment, `SRF` customer
  refund and `PRF` supplier refund. An owner or admin gets them from the button on the Transactions page.
- A sales credit note type (`SCN`) and a sales invoice type (`SIN`) under Admin, Transaction types.
- Three posted sales invoices for the customer, for different amounts (for example €123.00, €246.00 and €615.00), and
  one posted sales credit note for €36.90. Use dates a few days apart.

## 1. How forms open (owner)

1. Admin, Bank accounts, Add. The cursor is in **Code**, not in the Currency list.
2. The **Active** and **Default for its currency** boxes sit on one line each, level with the field height.
3. Cancel. Open an existing account with Edit. The code is greyed and the cursor is in **Name**.
4. Open Transactions, then a payment type, then Add. **Number**, **Currency** and (for a euro customer) **Exchange
   rate** have a quiet grey background. The other fields are white. Hovering a grey field does not change its border.

## 2. A receipt from an invoice (owner)

1. Open a posted sales invoice. A fourth tab, **Payments**, is next to Payment. Open it.
2. It shows the total, what is paid and what is open, and a **Record receipt** button.
3. Press it. A new receipt opens for the same customer. The amount and the invoice's allocation both show the open amount.
4. Choose the bank account if it is not already chosen. Press **Save and post**.
5. The invoice list now has the invoice under the **Paid** filter, and **Amount due** is 0.00.
6. The title bar reads "Customer receipt (SRC)", not just the code.

## 3. Allocating by double click (owner)

1. Transactions, Customer receipt, Add. Choose the customer. The open invoices appear, with a line saying to double click one.
2. With **Amount** empty, double click the €246.00 invoice. The amount becomes 246.00 and so does its Allocate box.
3. Change the amount to 100.00 and clear the box. Double click the €246.00 invoice again. Nothing is allocated and the
   status row says 246.00 is more than the 100.00 left to allocate.
4. Change the amount to 400.00 and double click the €246.00 invoice. It fills. Then double click the €615.00 invoice.
   It is refused, because only 154.00 is left.
5. Try **Allocate oldest first** and **Clear**. Save and post. The first invoice is paid and the second part paid.
6. Check you can still select and copy an invoice number in this list, and that double click does not highlight a word.

## 4. A credit note (owner)

1. Open the posted credit note, then its **Payments** tab. It shows the whole €36.90 as balance.
2. **Apply to an invoice**. Double click an invoice. Its open amount is more than the balance, so it is refused with a message.
3. Type 36.90 against an invoice and press **Apply**. The credit note shows its balance used. The invoice shows part paid.
4. Open a second posted credit note. Press **Refund**. A customer refund opens with the balance. Save and post.

## 5. Mistakes (owner)

1. Open a posted receipt. Press **Remove** on an allocation. A reason is required. The removed allocation is listed
   with the reason, and the money shows as on account.
2. Allocate it to a different invoice and press **Allocate**.
3. Press **Void** on a posted receipt. A reason is required. The invoice it paid is open again.

## 6. A member

In the private window, signed in as the member:

1. The member can add, save, post and delete a receipt, and allocate it.
2. The member sees no **Void** button and no **Remove** on an allocation.
3. The member cannot create the payment types: the button on the Transactions page is not there.

## 7. Lists and parties (owner)

1. A sales invoice list has **Paid** and **Amount due** columns and a payment filter with Unpaid, Part paid and Paid.
   The credit note list calls the column **Applied**. The status tags are soft tints, not solid blocks.
2. The customer's page: **They owe you** is open invoices, less credit note balances, less receipts not yet applied.
   **On account** lists what is waiting to be applied. If you leave a large receipt unapplied, the card turns round and
   says what you owe them.
3. Open `/transactions/SI` by typing it. It sends you to `/transactions/SIN`.

## What to send back

For anything that was not as written: the step number, what you expected, what you saw and a screenshot. If a number looks wrong,
note the document numbers involved.
