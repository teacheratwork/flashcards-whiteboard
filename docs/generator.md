# Sentence generator — rules and design choices

What the **🎲 Sentence** button builds, which cards it uses, and why.
Every rule says where to change it. Code: the "sentence generator" section of
`src/app.js`. Words and tags: `assets/vocab.json`. After any change run
`python tools/build.py`.

## Levels are exact

A level-N sentence always has the structure of level N. Features of lower levels
may appear inside it (a level-6 sentence can contain a plural or an adjective),
but a level-6 sentence is never just a level-3 one.
*Why:* the teacher picks a level to practise that structure (decided 2026-10-09;
before, ~40% of sentences came from easier levels).

| Level | Structure added | Example |
|---|---|---|
| 1 | the/a + noun + verb-s, or proper noun + verb-s | the fox runs |
| 2 | plural (noun-s) or possessive (orange dot) | the foxes run · my fox runs |
| 3 | adjective | the black fox runs |
| 4 | green dot: *is* + adjective, *let's* + verb | the fox is black · let's run |
| 5 | number, or two subjects joined by **+** (verb without s) | three foxes run · the fox + the frog run |
| 6 | blue dot + *the* + place | in the garden the fox runs · the fox is in the garden |

*Change:* the `TEMPLATES` list (`lvl` = level, `ok` = cards needed, `make` = builder).

## Optional time phrase

About 1 sentence in 3 gets a time phrase at the end, **in addition to** the
level's structure (it never replaces it, so levels stay exact).

| Piece | Example | From level | Why |
|---|---|---|---|
| *every …* card | the fox runs **every day** | 3 | one card, no dot; with the present-simple *-s* it shows what that tense is for (habits) |
| blue dot + season/festivity | my cats play **in winter** · … **at Christmas** | 6 | uses the blue dot, which the level ladder introduces at 6: up to level 5 no blue dot ever appears |

- At most one time phrase per sentence (no "every day at Christmas").
- The preposition is set automatically from the `prep` field in `vocab.json`
  (*in* winter, *in* spring, *at* Christmas) and no red dot follows it
  (English says "in winter", not "in the winter").
- Never added to *let's* + verb: "let's play every day" works, but
  "let's sleep at Christmas" sounds odd.

*Change:* `TIME = { chance, everyFrom, prepFrom }` in `src/app.js`; the *let's*
exclusion is in `generateSentence`; a new season/festivity card needs
`"tag": "abstract"` and a `"prep"` in `vocab.json`.

## Which cards are used — tags in `vocab.json`

| Tag | Normal | 🤪 Silly | Why |
|---|---|---|---|
| nouns `animate` | subject | subject | living things can run, sleep, sing |
| nouns `thing` | — | subject | "the pen sings" is silly but correct English |
| nouns `place` | only after the blue dot (level 6) | also subject | |
| nouns `abstract` (winter, spring, Christmas) | only in the time phrase | same | as subjects they give wrong English ("a winter sleeps", "my spring"): they take no article and don't pluralise |
| verbs `intr` | yes | yes | they make a full sentence alone |
| verbs `trans` (take, open, see…) | — | yes | they need an object ("the fox takes …") and the generator builds no objects |
| adjectives `any` | yes | yes | |
| adjectives `weather` (sunny, snowy) | — | yes | they don't describe a subject ("the sunny fox") |
| time cards (every …) | time phrase (level 3+) | same | |
| numbers | level 5 | level 5 | *one* only with a singular noun |

`nopl: true` = never pluralised (hot chocolate, fairy lights); `pl` = irregular plural.
*Change:* re-tag a card in `vocab.json` (e.g. *doll* → `animate` to use it as a subject).

## Student view (shared lesson set)

- Only the lesson's cards are used, **markers included** (red/orange/green/blue
  dots, `s`, `+`). Most sentences need the `s` marker and the red dot, so a lesson
  set should include them.
- If the cards can't make a sentence of the chosen level, nothing is generated
  and a message suggests the levels that work. There is no silent fallback to
  the whole deck (decided 2026-10-09).
- The teacher view (builder) always uses the whole deck.

*Change:* `makePools` (`has` decides which cards count as available) and
`generateSentence`.

## Ideas not done yet

- Object sentences ("the fox takes the ball"): would bring in `trans` verbs and
  `thing` nouns without Silly. A new structure, possibly a level 7.
