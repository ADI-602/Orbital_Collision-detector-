# Orbital Risk Advisor — Pitch Script (Simple Version)

For: explaining the project to our teacher and getting the whole team aligned
Length: ~3 minutes spoken, plus notes on what to actually show on screen

---

## The one-sentence version (memorize this)

"We're building a tool that watches satellites in space, calculates the real risk of two of them crashing into each other, and uses AI to explain that risk in plain English so a human can quickly decide what to do."

---

## Part 1 — The Problem (30 seconds)

**Say:**
"There are over 40,000 tracked objects orbiting Earth right now — satellites, dead satellites, and debris. Several times a day, two of these objects get close enough that someone has to decide: is this dangerous, and should we move our satellite out of the way?

The problem is, the answer to 'is this dangerous' comes out as a scary math formula — a probability number and a bunch of statistics. That's hard for a human to act on quickly, especially under time pressure."

**Show on screen:** a simple graphic or globe with a few dots (satellites) and one highlighted pair getting close together.

---

## Part 2 — What We Built (60 seconds)

**Say:**
"Our project has two halves.

**Half one is real physics.** We pull real satellite tracking data, calculate exactly where each object will be in the future using the same math real space agencies use, and calculate the actual probability that two objects will collide. This part is not AI — it's real orbital mechanics, and we tested it against a known, published example to make sure our numbers are correct.

**Half two is AI.** Once we know the risk number, AI takes over and does the part humans actually need: it explains _why_ this is risky, compares a few options for avoiding the collision — like 'move the satellite a little now vs. wait and move it more later' — and gives a clear recommendation in plain language.

So: the physics tells you the risk. The AI tells you what to do about it."

**Show on screen:** the collision-risk number appearing, then next to it the AI's plain-English explanation appearing — visually side by side, so the contrast is obvious.

---

## Part 3 — The Demo (60 seconds)

**Say:**
"To prove this isn't just theory, we're replaying a real event. In 2004, ESA's Envisat satellite had a real close call with a piece of space debris. We're going to show our system tracking that same event, day by day, watching the risk number climb — exactly like it did in real life — until it crosses the danger threshold, just like it really did. Then our system gives the same kind of recommendation a real operator would have needed."

**Show on screen (this is your actual demo):**

1. Globe view, real live satellite data, calm state
2. Trigger the replay — a countdown showing 4 days before the close approach, with the risk number updating each day
3. Risk crosses the danger line — visually flag it
4. AI-generated explanation and recommendation appears
5. Reveal: "This really happened. ESA really moved the satellite. We just rebuilt the decision-making process."

---

## Part 4 — Why This Matters / Close (30 seconds)

**Say:**
"The theme of this challenge is turning space data from 'a lot of numbers' into 'clear, usable decisions.' That's exactly what we built — real physics for the hard math, AI for making it understandable. We're not using AI to fake the science. We're using it exactly where it's actually useful."

---

## Cheat sheet for teammates — if someone asks you a quick question

**"What does the physics part actually do?"**
→ "It takes satellite tracking data and calculates where objects will be in the future, then calculates the odds of two of them hitting each other. We're using real, established methods — not made up."

**"What does the AI part actually do?"**
→ "It takes that risk number and turns it into something a human can understand and act on — an explanation and a recommendation, not a raw statistic."

**"Is this AI trying to do the physics?"**
→ "No — and we're being upfront about that. The physics is separate and validated on its own. The AI only explains and recommends, it doesn't calculate collision risk itself."

**"How do you know your numbers are actually correct?"**
→ "We tested our collision-risk calculation against a known published test case with a known correct answer before trusting it on real data."

**"What's simplified / not fully real?"**
→ "We're not modeling every satellite in the world at once — we focus on a smaller set for our demo. And our 'avoid the collision' maneuver is a simplified version of what a real satellite burn would involve. We say this openly rather than pretending it's more complete than it is."

---

## One-line summary if you only remember one thing

**"Real physics computes the risk. AI makes the risk understandable and actionable."**
