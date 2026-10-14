---
description: A relentless interview to sharpen a plan or design, which also writes the glossary and decision records as we go.
default: off
loads: ["grilling", "domain-modeling"]
optional: ["workspace", "git_repositories"]
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
Run the loaded `grilling` playbook on what the person wrote, and keep the domain model with the loaded `domain-modeling` playbook as you go: find where this thread's documents live first, challenge their terms against the glossary in each round, and write the terms and decisions they settle as `domain-modeling` says. If they gave nothing to grill yet, ask in one line what plan, decision, or idea they want to sharpen.
