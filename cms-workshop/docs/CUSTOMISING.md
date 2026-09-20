# Setting up a dealership

Everything that differs between one site and the next is in **Setup**, and
every setting there maps to one place in `assets/config.default.js`. That
file is commented, so it doubles as the reference.

## The order that works on site

Doing it in this order means nothing has to be redone:

1. **Data → Clear everything for a live setup.** This removes the demo
   customers, vehicles and job cards and leaves the configuration alone.
2. **Dealership** — trading name, branch, dealer code, VAT number, contact
   details. These land on the customer link and on printed job cards.
3. **Branding** — if the dealership wants its own mark on the customer link,
   upload it here. The staff apps keep the CMS eco lock-up.
4. **Diary** — opening days, hours, Saturday close, slot length, how many
   jobs may land in one slot, and the day's sellable hours. Get this right
   before anyone books, because the wizard and the board both read it.
5. **Rates and pricing** — VAT, the franchise's labour rates, the parts
   markup matrix, sundries and the cap.
6. **People** — everyone who signs in, with their role and PIN. Technicians
   use the same PIN on the workshop app.
7. **Roles** — which screens each role gets and in what order. The first
   screen a role has is where its people land unless they set their own.
8. **Words we use** — match the franchise's vocabulary before training, so
   nobody learns a word they will not see again.
9. **Modules** — switch off what this site does not do. Screens and buttons
   disappear with the module.
10. **Statuses** — only if the site runs a different flow. The board, the
    customer's tracker and the reports all follow this list in this order.
11. **Health checks** — the template the technicians will actually use, with
    the measurements and thresholds the franchise works to.
12. **Menus and parts** — the service menus and the price file, or leave
    them to come from Superservice and Evolve once those are wired in.
13. **Messages** — what the customer actually receives. Read them out loud;
    they are the dealership's voice, not ours.
14. **Authorisation** — code, signature, per-item approval, link expiry,
    and the terms printed above the signature. Check the terms against what
    is on the wall in reception.
15. **Integrations** — Evolve account and posting behaviour, Infomedia brand
    code, messaging providers.
16. **Data → Export this dealership.** Keep the file. It is the whole setup
    in one place, and it is how the next branch takes twenty minutes
    instead of a morning.

## Carrying a setup to the next site

**Data → Export this dealership** writes one JSON file. At the next site,
**Data → Import a profile** reads it back. Import replaces the whole
configuration and leaves customers, vehicles and job cards untouched — so
import first, then adjust the name, branch, dealer code and people.

## The settings, and where they live

| Setup tab | In `config.default.js` | Notes |
|---|---|---|
| Dealership | `dealer` | Name, branch, VAT number, logos |
| Diary | `diary`, `bays` | `days` is 0–6 with Sunday as 0 |
| Rates and pricing | `money` | Rates, markup bands, VAT, sundries |
| People | `people` | `role` must match a key in `roles` |
| Roles | `roles` | `nav` is screen ids in order; `can` is permissions, `*` for everything |
| Words we use | `terms` | Read everywhere through `CMS.t()` |
| Modules | `features` | Switching one off hides its screens |
| Statuses | `statuses` | `stage` drives the customer tracker; `wip` counts as work in progress |
| Health checks | `vhcTemplates` | Groups, items, `measure`/`unit`, `amberBelow`, `redBelow`, `requirePhotoOn` |
| Menus and parts | `menus`, `parts` | `parts` holds cost, OEM list, bin, `supersededBy` |
| Messages | `messages` | Placeholders below |
| Authorisation | `authorisation` | Code, signature, expiry, terms |
| Integrations | `integrations` | Evolve, Infomedia, messaging |

## How prices are worked out

A part's **sell** price is the Evolve price-file **cost**, plus the markup
for the band that cost falls into. VAT is added for display only and never
stored on the line — which is why a price mismatch with Evolve should
always be compared VAT-exclusive first.

Labour is hours × the rate on the line. A menu carries its own rate, so
service work can be priced differently from retail repair on the same job.

Sundries are a percentage of labour and parts, capped.

## Health-check thresholds

An item with `measure` gets a numeric field on the tablet. Give it
`amberBelow` and `redBelow` and the technician's number sets the colour:

```json
{ "id": "t-lf", "label": "Tyre left front",
  "measure": "Tread", "unit": "mm", "amberBelow": 3, "redBelow": 1.6 }
```

Type 1.4 and the item goes red on its own. `requirePhotoOn: ["r","a"]` makes
a photograph compulsory on red and amber, and the app says so on the item
and again when the check is finished.

## Message placeholders

`{{name}}` first name · `{{fullname}}` · `{{ref}}` the job reference ·
`{{reg}}` · `{{dealer}}` · `{{advisor}}` · `{{link}}` the customer link ·
`{{otp}}` the one-time code · `{{total}}` the amount awaiting approval ·
`{{time}}` the booking slot.

## Training switches

**Integrations → Training switches** makes the next Evolve post fail, with a
reason you choose. It is there so a rollout can show a dealership what a
failed post looks like, and walk them through fixing the cause and using
Retry, without anything actually breaking.

## Going further

Two things are edited as JSON because they are structures rather than
settings: the health-check templates and the menus' parts lists. Both have a
JSON editor under their own tab, and both validate before they save.
