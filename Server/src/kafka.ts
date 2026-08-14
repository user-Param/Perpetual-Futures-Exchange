import { Kafka, Producer, Consumer, logLevel } from "kafkajs";

const brokers = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");

export const kafka = new Kafka({
  clientId: "exchange-api",
  brokers,
  logLevel: logLevel.WARN,
});

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (producer) return producer;
  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  return producer;
}

export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}

export const KAFKA_TOPIC_ENGINE_EVENTS = "engine_events";
export const KAFKA_TOPIC_ORDER_COMMANDS = "order_commands_kafka";

export async function publishEngineEvent(event: Record<string, unknown>): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic: KAFKA_TOPIC_ENGINE_EVENTS,
    messages: [
      {
        key: typeof event.market === "string" ? event.market : "global",
        value: JSON.stringify(event),
      },
    ],
  });
}

export function buildConsumer(groupId: string): Consumer {
  return kafka.consumer({ groupId });
}
