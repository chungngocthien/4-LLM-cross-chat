This is an Electron-based repository designed to chat with four LLMs—ChatGPT, Gemini, Claude, and Grok—simultaneously using a single prompt, allowing users to compare how each model responds to the same issue.

I created this repository to uncover hidden aspects of problems or to gain deeper insight by reviewing multiple responses.

Features:
It logs in via the web interfaces of the four LLMs; their outputs appear in separate windows, and users can inject "thought" content from an LLM's output into the input for the next turn of the conversation.

The repository encourages LLMs to read each other's outputs, though it does not yet function as a fully autonomous AI Agent system; it relies primarily on a "Human-In-The-Loop" approach.

It utilizes the standard web chat interfaces rather than APIs, allowing users to leverage free account tiers and optimize token usage.

Projects can be saved as links for future access.

In short, I view this as a "mini AI Agent," as I haven't implemented recursive processing yet.

If you are interested in the development process, simply feed the [`narrative-log.txt`](https://github.com/chungngocthien/4-LLM-cross-chat/blob/main/narrative-log.md) file from the repository into any LLM, and it will explain the full story to you. I am also cultivating the habit of preserving "memories" for LLMs.

Watch the video where I discuss the project to see it in action—click the image below.

[![Demo](https://img.youtube.com/vi/xNooxJJgpvg/maxresdefault.jpg)](https://www.youtube.com/watch?v=xNooxJJgpvg)
