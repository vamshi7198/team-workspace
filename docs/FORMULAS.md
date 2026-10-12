# Formula properties

Formulas are evaluated by a small, sandboxed interpreter (`web/src/lib/db-engine/formula.ts`).
They never run JavaScript, cannot read other databases, and are limited in length (2,000
characters), nesting (40 levels) and work (10,000 steps).

## Syntax
- Read a property of the same row: `prop("Due date")`. Names are case-insensitive. A formula
  can't read another formula.
- Text in double or single quotes: `"Done"`. Numbers: `12`, `3.5`. Booleans: `true`, `false`.
- Operators: `+ - * / %`, comparisons `== != > >= < <=`, logic `and or not` (or `&& || !`).
  `+` joins text if either side is text. Division by zero gives an empty value.

## Functions
| Function | Example |
|---|---|
| `if(condition, then, else)` | `if(prop("Done"), "✅", "⏳")` |
| `concat(a, b, …)` | `concat(prop("Owner"), " – ", prop("Status"))` |
| `length`, `lower`, `upper`, `contains(text, search)`, `empty(value)`, `format(value)` | |
| `round(n, digits?)`, `floor`, `ceil`, `abs`, `min(…)`, `max(…)`, `sum(…)`, `toNumber(v)` | |
| `now()`, `today()` | |
| `dateBetween(a, b, unit)` | `dateBetween(prop("Due date"), today(), "days")` |
| `dateAdd(date, n, unit)` | `dateAdd(prop("Start date"), 2, "weeks")` |
| `formatDate(date)` | `YYYY-MM-DD` |

Units: `minutes`, `hours`, `days`, `weeks`, `months`, `years`.

How values appear inside formulas: select/status give the option name, multi-select and person
give names joined by commas, a relation gives the number of linked pages, and a checkbox gives
true or false.

## Rollups
For values across related rows, use a **Rollup** property instead (count, sum, average,
min, max, percent checked, percent complete, show values). For example, project **Progress** is
"percent of related Tasks whose Status is in the Complete group".
