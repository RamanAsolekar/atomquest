# Architecture Diagrams

The canonical diagrams are authored as Mermaid in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) so they render directly on GitHub and stay
version-controlled with the code.

To export a PDF/PNG for hackathon submission:

```bash
# using the mermaid CLI
npm i -g @mermaid-js/mermaid-cli
# extract a fenced ```mermaid block into diagram.mmd, then:
mmdc -i diagram.mmd -o high-level.png -b transparent
```

Diagrams included:
1. High-Level Architecture
2. Detailed Component Diagram
3. ER Diagram
4. Signaling Flow (join + media)
5. Recording Flow
6. Reconnect grace-window Flow
7. Deployment Architecture

Place exported images here as `high-level.png`, `er.png`, etc.
