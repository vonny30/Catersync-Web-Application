# Select-all must cover every matching record, not just the visible page

Two files, identical bug in both: `src/pages/Bookings.jsx` and
`src/pages/ShortOrders.jsx`. Fix both the same way.

**Line numbers in this brief may have shifted** — `Bookings.jsx` grew when the
approval-fee fix landed. Find the code by name, not by line.

---

## The bug

`toggleSelectAll` — `Bookings.jsx` ~line 1173, `ShortOrders.jsx` ~line 1105:

```js
const visibleIds = bookings.map(b => b.booking_id);
const allSelected = visibleIds.every(id => selectedBookings.includes(id));
setSelectedBookings(allSelected ? [] : visibleIds);
```

Two separate defects in three lines.

**It only sees one page.** `bookings` holds a single page of results — the fetch
uses `.range(from, to)` — so select-all can never reach a row the manager isn't
currently looking at.

**It replaces instead of merging.** The second line throws away the whole
existing selection. So ticks made on other pages are silently destroyed, which
also kills the obvious workaround of paging through and ticking rows by hand.
Individual ticks *do* persist across pages (`toggleSelectBooking` appends);
select-all is what wipes them.

The header checkbox has the matching problem — `checked={bookings.length > 0 &&
bookings.every(...)}` is page-scoped, so it reads as fully checked when only the
current page is selected.

---

## What to build

**"Select all" means every record matching the current filters** — active tab,
search term, status and date filters — not just the page, and not the whole
table.

### 1. Fetch the matching ids

Add a function that returns the primary key of every matching record: the same
query the list already builds, with the same filters, selecting only the id
column, and **without** `.range()`.

Do **not** re-implement the filter logic. Extract what the existing fetch uses
into something both call, so the list and the select-all can never disagree
about what "matching" means. Two copies of a predicate drifting apart is the
defect class this codebase has shipped repeatedly — the package-save fix landed
for exactly that reason.

Page it through `utils/fetchAllRows.js` so it cannot truncate at PostgREST's
1000-row cap, ordered on the primary key so paging is stable.

### 2. Header checkbox, driven by the full matching set

| State | Checkbox |
|---|---|
| Nothing selected | unchecked |
| Some selected | **indeterminate** |
| All matching selected | checked |

Indeterminate needs `el.indeterminate = true` via a ref — the `checked` prop
alone cannot express it. Clicking when unchecked or indeterminate selects all
matching; clicking when fully checked clears the selection.

### 3. Merge, never replace

Selecting all unions with existing ticks. Ticking a row on page 2 after
selecting all on page 1 keeps both. Only the explicit clear empties it.

### 4. Say what is selected

Above the table, when a selection exists, show `N selected`. When N is exactly
the current page but more records match, offer the wider action:

```
All 10 on this page selected · Select all 47 matching
```

as a clickable control. A manager about to bulk-delete has to be able to see
whether that means ten records or four hundred.

### 5. Check the delete confirmation still tells the truth

The bulk-delete confirm interpolates `selected.length`. Verify it reports the
real total now that it can be far larger than a page. The password step stays
exactly as it is.

### 6. Clear the selection when the filters change

Filters, search, or active tab changing must clear the selection. A selection
made under one filter must never survive into another — otherwise the manager
deletes rows they never saw.

---

## Acceptance

Run these on the live site with real data, on **both** pages.

1. With more than one page of results, click the header checkbox. Every
   matching record is selected and the count above the table equals the
   "N results" figure.
2. Tick two rows on page 1, go to page 2, tick a third. All three survive. Now
   click the header checkbox — it adds the rest and does **not** drop the three.
3. With a partial selection, the header checkbox renders indeterminate — a dash,
   not a tick and not empty.
4. Select all, then switch status tab. The selection clears.
5. Select all under a filter matching only 2-3 records, then bulk-delete. The
   confirmation names the right number and exactly those records go.
6. A filter matching zero records leaves the header checkbox disabled.

Report each item with what you actually observed, not what you expect.

## Do not

- Do not change the bulk-delete guards or the password confirmation.
- Do not change any query's filter semantics — only add an ids-only variant.
- Do not add a "select across all pages" mode separate from the header
  checkbox. One control, one meaning.
