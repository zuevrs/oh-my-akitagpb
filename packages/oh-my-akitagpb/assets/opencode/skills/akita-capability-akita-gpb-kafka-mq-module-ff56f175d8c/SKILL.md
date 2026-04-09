---
name: akita-capability-akita-gpb-kafka-mq-module-ff56f175d8c
description: Capability-bound Phase 1 Akita kafka-mq-module bundle for source-backed Kafka, IBM MQ, and Artemis message transport steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/packs/oh-my-akitagpb/capability-manifest.json` activates `akita-capability-akita-gpb-kafka-mq-module-ff56f175d8c`.

## Scope

- Exact maintainer-reviewed source pin: `ff56f175d8c`
- Module id: `akita-gpb-kafka-mq-module`
- Evidence base: `gpb-manifest.json` and reviewed public annotated step classes under `src/main/java/**/steps/**`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Kafka message publishing from reviewed table-driven parameters, including body, topic, key, selected header forms, and scenario-variable rows.
2. Kafka message lookup, absence checks, header/body extraction, and message capture using only the reviewed step families and their narrow matching semantics.
3. IBM MQ connection creation, queue send, queue read by selector, explicit connection close, and stored-message text containment checks.
4. Artemis connection lifecycle, queue send/read/browse operations, durable topic subscription/read/unsubscribe operations, and property-based filtering only where the reviewed steps expose it.
5. Artemis stored-message assertions for text, headers, JSON, and XML, plus reviewed JSONPath/XPath extraction into scenario variables.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, hooks, config classes, validators, matchers, processors, documentation prose, or transport-specific examples, treat it as `unsupported` or `needs-review`.
- Do not infer generic broker administration, consumer-group management, delivery guarantees, ordering guarantees, exactly-once semantics, arbitrary stream processing, or transport parity across Kafka, IBM MQ, and Artemis.
- Do not flatten the reviewed surface into one generic “message broker” abstraction. Kafka, IBM MQ, and Artemis have different reviewed steps and different limits.
- Treat Kafka matching semantics as limited to the reviewed families: JSONPath-backed checks, header matching, key lookup, reviewed body save flows, and reviewed negative checks with source-backed timeouts.
- Treat IBM MQ support as selector-driven queue messaging only. Do not infer queue browsing, topic semantics, broker setup, or generic JMS administration from the MQ steps.
- Treat Artemis topic semantics as durable-subscription based only. Subscriptions must be created before publish when the reviewed flow depends on receiving a message.
- Treat Artemis JSON/XML assertions and extraction as operating on stored message bodies only after reviewed read/browse steps save the message into a scenario variable.
