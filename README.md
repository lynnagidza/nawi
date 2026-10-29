# Nawi

A small revision site for the **MB-820: Microsoft Dynamics 365 Business Central Developer** certification.

Nawi is built around practice questions instead of reading: answer, see why, then write down what you learnt. Questions are original, written from the official Microsoft Learn documentation. Every question carries a link to its source. No exam dumps.

Live site: `https://lynnagidza.github.io/nawi/`

## What it does

| Mode              | Questions                                                       | Time     | Feedback                         |
| ----------------- | --------------------------------------------------------------- | -------- | -------------------------------- |
| Quick             | 10                                                              | 15 min   | After every question             |
| Standard          | 25 (one case study)                                             | 40 min   | At the end, with a review screen |
| Exam-like         | 50 (two case studies), drawn in the official domain proportions | 100 min  | At the end, with a review screen |
| Practice by skill | Every standalone question in one skill area                     | No timer | After every question             |

- Results show an estimated score out of 1000 (pass mark 700), a breakdown grouped by exam domain, and links to Microsoft Learn for weak areas.
- Standard and Exam-like let you skip, flag for review, and open a review list. Once you leave a case study you can't return to it, as on the real exam.
- The score is only an estimate. Microsoft doesn't publish its scaling, and some real questions give partial credit that Nawi doesn't model.

## Run it locally

Open the folder in VS Code and use the **Live Server** extension. Double-clicking `index.html` won't work, because the browser blocks `fetch` on local files.

## Project structure

```
nawi/
├── index.html
├── css/style.css
├── js/app.js
├── data/
│   ├── questions.json   the question bank
│   ├── resources.json   skill -> Microsoft Learn link shown under "Where to focus"
│   └── domains.json     exam domains, weights and the skills inside each
└── README.md
```

## Adding questions

Add objects to the array in `data/questions.json`. Mind the commas, because one typo makes the site say "Could not load questions".

Every question needs: `id` (unique), `skill`, `question`, `explanation`, `source` (page title) and `url` (the exact page the answer came from).

The `skill` text must match a skill listed in `data/domains.json` and have an entry in `data/resources.json`, character for character.

| Type                    | Shape                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Single choice (default) | `options` list and `answer` (index of the correct option)                                                        |
| Select all that apply   | `"type": "multi"`, `options`, and `answer` as a list of indexes, e.g. `[0, 2]`                                   |
| Ordering                | `"type": "order"` and `items` written in the **correct** order (the site shuffles them)                          |
| Matching                | `"type": "match"`, `pairs` as `[target, correct item]`, and optional `extras` as distractors                     |
| Case study              | `"type": "case"`, `title`, `scenario` (use `\n\n` between paragraphs) and a `questions` list of normal questions |

Write each explanation so it still makes sense after the question has gone: say why the answer is right and, where useful, why the near-miss is wrong.

## Adding a new skill area

1. Add the skill name to the right domain in `data/domains.json`.
2. Add an entry to `data/resources.json` with a `title`, `url` and one-line `note`.
3. Use that exact skill name in the new questions.

## Yearly refresh checklist

MB-820 is renewed every year and Business Central ships major updates in April and October, so do this once a year (and after each major release if you can).

- [ ] Open the official [MB-820 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/mb-820) and note the **skills measured date**.
- [ ] Compare the domains and their weights with `data/domains.json`. Update `weight`, names and the skills inside each domain if they changed. Exam-like uses these weights automatically.
- [ ] Look for subtopics that were added, removed or moved between domains. Add questions for new ones and retire questions for removed ones.
- [ ] Check the Microsoft Learn exam pages for the exam duration and question types. Update `minutes` and `count` for `exam` in `TIERS` in `js/app.js` if they changed.
- [ ] Re-check the facts most likely to move: update schedule and periods (`life-*`), AppSource validation requirements (`as-*`), launch.json and debugging options (`env-*`, `dbg-*`), runtime and feature names in app.json, and anything marked "applies to release wave X".
- [ ] Click through the `source` links and fix or replace any that no longer open.
- [ ] Skim the "Where to focus" links in `data/resources.json` and update titles and URLs.
- [ ] Add any questions you flagged during the year, and retire or fix any whose explanation you found unclear.
- [ ] Update the "Skills measured" date in your own notes, push, and hard refresh the live site.

## Known gaps and ideas

- Difficulty levels (Beginner, Intermediate, Advanced) are not tagged yet.
- Azure Key Vault isn't on the MB-820 skills list, so it has no questions. It could become a separate "beyond the exam" track.
- Progress history, a missed-questions queue and a teach-back notes box are not built.
- Drag and drop works with a mouse. On touch screens, tap an item and then tap a target.
