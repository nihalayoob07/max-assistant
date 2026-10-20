# How the front desk negotiates

The code decides every price (`scripts/desk.py`: `ladder`, `negotiate`); the AI only words the move it is
given, in the style in `STYLE`. Each rule below comes from negotiation or sales research.

| Rule in the desk | Why |
|---|---|
| Open at the list price and **hold it on the first lowball**. The first reply sells value for *their* business and asks one question. | First offers anchor the final price, and the side that anchors first tends to do better (Galinsky & Mussweiler 2001). Conceding straight away, as the old desk did (₹29,999 → ₹28,499 on the first push), throws the anchor away. |
| Counters are **precise** (₹29,300, ₹28,700, never ₹29,000). | Precise numbers come across as calculated and well informed, so the other side adjusts less from them (Mason, Lee, Wiley & Ames 2013). |
| Concessions **taper**: 35%, then 30%, then the last 35% of the gap, and the limit only as an explicit final move. | Shrinking concessions signal that you're close to your limit, so the other side expects less and pushes less (Tey, Schaerer, Madan & Swaab 2021). Most people concede in equal steps, which invites more pushing. |
| **We only move after they move.** If they repeat the same number, we hold and ask what would make it work. | Reciprocity: a concession you give for nothing says it was worth nothing, and invites the next demand. Every move asks for something back (the yes, the go-ahead). |
| If their budget is far off, we offer a **smaller plan** at its own price instead of cutting this one. | Trading scope instead of price keeps the price honest (an integrative trade, not a straight discount). |
| A "final offer" close to our limit goes to the owner, once. The owner sets a price, a firm "no further negotiation" price, or how far Max may still drop. | The owner decides the real walk-away point; Max never reveals it. |
| Replies name the emotion when it shows ("sounds like budget's tight"), ask "what"/"how" questions, and never "why". | Tactical empathy, labels and calibrated questions (Voss, *Never Split the Difference*) lower defensiveness and bring out the real constraint. |
| One question at a time, short messages, back and forth. | In Gong's call data, deals that close have more speaker switches and fewer checklist-style questions. |
| Warm, specific and human, with no stock openers and no repeated sentences (the code rejects a reply that repeats one of our earlier sentences word for word). | Customers judge AI negotiators on how the chat felt, not just on the price, and that judgement drives whether they come back (Chaudhuri & de Bruyn 2025). |

## Sources
- Galinsky & Mussweiler (2001), *First offers as anchors*. Summary: https://hbswk.hbs.edu/archive/when-to-make-the-first-offer-in-negotiations
- Mason, Lee, Wiley & Ames (2013), *Precise offers are potent anchors*, JESP 49(4). Summary: https://www.pon.harvard.edu/daily/negotiation-skills-daily/effective-negotiation-techniques-strive-for-a-precision-advantage
- Tey, Schaerer, Madan & Swaab (2021), *The impact of concession patterns on negotiations*, OBHDP: https://knowledge.insead.edu/strategy/negotiators-should-decrease-concessions-across-rounds
- Trading concessions: https://www.shapironegotiations.com/communication/negotiation-concessions-explained
- Voss, *Never Split the Difference* (notes): https://grahammann.net/book-notes/never-split-the-difference-chris-voss
- Gong Labs, talk-to-listen ratio and discovery calls: https://www.gong.io/resources/labs/talk-to-listen-conversion-ratio/
- Chaudhuri & de Bruyn (2025), *Bots Bargaining with Humans*, JMR: https://faculty.essec.edu/research/16020-bots-bargaining-with-humans-building-ai-super-bargainers-with-algorithmic-anthropomorphization
