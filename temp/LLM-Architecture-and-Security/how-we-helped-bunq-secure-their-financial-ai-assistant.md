# How we helped Bunq secure their financial AI assistant

**Thomas Vissers & Tim Van hamme** · April 29, 2026

Blue41 helped [Bunq](https://www.bunq.com/), Europe's second-largest digital bank with more than 20 million customers, secure its AI assistant against spearphishing risks. During our testing, we identified an indirect prompt injection vulnerability where a single bank transfer could turn the assistant into a delivery channel for a highly credible phishing attack.

We are sharing this case because the underlying issue is not unique to one bank. It is a broader architectural challenge for financial institutions deploying AI assistants that process transaction data, customer records, documents, messages, or other untrusted inputs.

> From a €0.02 bank transfer to a personalized phishing scenario inside a banking AI assistant.

---

## The setup

Modern banking apps increasingly include AI-powered features. These sit between the user and a range of backend data sources, such as transaction records, product documentation, account details, support content, and other internal systems. They use a large language model to answer natural-language questions based on that context.

When a user asks, "Give me an overview of my recent transactions," the assistant fetches the relevant records and passes them to the LLM as context. The model then summarizes the data in a conversational response.

The security challenge is that not all retrieved context should be trusted equally. A transaction description is data set by a third party. It may look like ordinary text, but when it is placed into an LLM context window, the model may interpret it as an instruction rather than as data.

This is the core problem behind indirect prompt injection: malicious instructions are not entered by the user interacting with the assistant. They are hidden inside external or retrieved data that the assistant later processes. For developers and security teams, it is complex to assess the risk-level of each piece of data indirectly pulled into the AI model.

---

## The attack scenario

The proof of concept required no access to the victim's device, no malware, and no traditional social engineering. The attacker only needed to send a small bank transfer.

**Step 1.** The attacker transfers a small amount, in our case €0.02, to the target. In the transaction description field, they include a carefully crafted prompt injection payload. This is the only action the attacker needs to take.

**Step 2.** The victim opens the banking app and asks the AI assistant a routine question, such as "Show me my recent transactions". The rest of the attack is executed automatically and autonomously by the AI assistant.

To answer that question, the AI assistant retrieves the transaction data, including the attacker's transfer, and passes it to the LLM as part of the context needed to answer the user. The LLM then processes the injected instructions inside the transaction description. In our controlled demonstration, the assistant was manipulated into launching a spearphishing attack to the bank's user, presented as a legitimate reauthentication request from the bank.

> Anatomy of the attack: the attacker injects malicious instructions through a transaction description (1), the user queries the assistant (2), the transaction data is retrieved into the LLM context (3), and the assistant's response is influenced by the injected content (4).

The resulting message appears inside the bank's own application, from the bank's own AI assistant. It can reference real transaction details and user-specific information, making it a highly credible phishing attack.

The same trust-boundary failure can lead to multiple attack scenarios, depending on the capabilities of the AI agent.

---

## Why this matters for financial institutions

Several properties make this class of attack particularly relevant for banking and financial services.

**The injection surface is common.** Transaction descriptions, payment references, merchant metadata, support messages, uploaded documents, emails, and CRM notes are all examples of data fields that may eventually be retrieved by an AI assistant. Many of these fields were never designed as trusted instruction boundaries.

**The delivery mechanism is cheap and credible.** A tiny transfer can place attacker-controlled text inside a victim's transaction history. The payload is then delivered through a highly trusted channel: the bank's own application.

**The assistant has privileged context.** Unlike a phishing email, a banking AI assistant can access real account context. That makes manipulated responses more personal, more timely, and more believable.

**The risk grows with capability.** A read-only assistant can still mislead users. An assistant with access to tools, workflows, or account operations introduces a larger risk surface. The more useful the assistant becomes, the more important its security model becomes.

The broader lesson is simple: **every untrusted data source that enters an AI assistant's context becomes part of the assistant's attack surface.**

---

## Why guardrails alone are not enough

A natural response is to add input filters, prompt injection classifiers, or content moderation rules. These controls can help, but they are not sufficient on their own.

Bunq's AI application had guardrails in place. The issue persisted because the malicious intent was not obvious from the transaction description in isolation. The payload did not need to say "ignore previous instructions" or another classic jailbreak pattern. It was crafted to blend into the transaction data and only became dangerous once the assistant retrieved it, placed it into context, and generated a response from it.

This is the limitation of relying on static text classification alone. The risk is not only in the text itself. The risk emerges from the interaction between untrusted data, retrieval logic, model behavior, application context, and the assistant's available outputs or actions.

The conclusion is that **guardrails alone are not enough** and need to be part of a layered security model. Input filtering helps reduce obvious attacks. Output constraints can prevent some harmful responses or data leaks. Least-privilege access limits impact. Runtime monitoring helps detect when the assistant behaves outside its intended operating profile.

---

## What effective mitigation looks like

There is no single control that solves indirect prompt injection. The practical goal is to reduce exposure, constrain dangerous behavior, and detect compromise when protections fail.

In this case, we discussed remediation options such as reducing unnecessary exposure to untrusted transaction fields, clearly separating data from instructions, constraining outbound links, and monitoring assistant behavior for anomalous outputs. We then validated together that the implemented mitigations effectively resolved the vulnerability.

More generally, financial institutions deploying AI assistants should consider four layers of control:

**1. Minimize unnecessary context.** Do not pass fields to the assistant unless they are needed for the user task. If a transaction description is not required to answer a question, it should not enter the model context by default.

**2. Treat retrieved data as untrusted.** Transaction descriptions, customer messages, documents, emails, and API responses should be handled as data, not instructions. The assistant architecture should preserve that distinction explicitly.

**3. Constrain sensitive outputs and actions.** Assistants should not freely generate links, request credentials, initiate sensitive workflows, or call high-impact tools without additional controls.

**4. Monitor runtime behavior.** Even with good preventive controls, novel attacks will appear. Security teams need visibility into what the assistant retrieved, what it produced, which tools it used, and whether that behavior matches the intended profile of the application.

---

## Why behavioral monitoring matters

Preventing every possible injection payload is unrealistic. Attackers can adapt wording, hide intent, and exploit application-specific context that generic classifiers do not understand.

But when an AI assistant is compromised, its behavior often changes in observable ways. It may start embedding external URLs, suppress information it would normally display, follow unusual response patterns, access unexpected data sources, or call tools in ways that do not match normal usage.

This is the approach Blue41 takes. We monitor AI agent runtime behavior and build behavioral profiles of how each assistant normally operates: which data sources it accesses, what response patterns are expected, which tools and APIs it uses, and what deviations should trigger investigation.

The goal is to give security and AI teams the visibility they need once AI assistants become part of real business workflows.

---

## The bigger picture

AI assistants in financial services are no longer experimental side projects. They are being deployed into customer-facing and employee-facing workflows, where they process sensitive data and influence real decisions.

Traditional application security assumes a relatively clear boundary between code and data. AI assistants blur that boundary. They retrieve data, interpret it, reason over it, and may eventually act on it. As a result, fields that were once harmless text can become instruction channels within potent applications.

This is especially important in banking, where assistants may interact with transaction data, customer records, compliance information, product documentation, support tickets, and eventually operational tools.

Financial institutions do not need to stop deploying AI assistants. But they do need to treat them as production systems with new trust boundaries, new failure modes, and new monitoring requirements.

---

## Conclusion

This case shows how a tiny, ordinary bank transfer can expose a much larger issue in AI assistant architecture. The problem is not the transfer itself. It is the fact that untrusted data can enter an assistant's context and influence what the assistant says or does.

The broader lesson is relevant for any financial institution deploying AI assistants: **prompt injection is not only a model problem. It is an application security problem, a data-flow problem, and a runtime monitoring problem.**

---

*原文来源: [blue41.com - How we helped Bunq secure their financial AI assistant](https://blue41.com/blog/how-we-helped-bunq-secure-their-financial-ai-assistant/)*