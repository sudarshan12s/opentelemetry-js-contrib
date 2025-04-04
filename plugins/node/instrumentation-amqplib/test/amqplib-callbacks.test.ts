/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import 'mocha';
import { expect } from 'expect';
import { AmqplibInstrumentation } from '../src';
import {
  getTestSpans,
  registerInstrumentationTesting,
} from '@opentelemetry/contrib-test-utils';

const instrumentation = registerInstrumentationTesting(
  new AmqplibInstrumentation()
);

import * as amqpCallback from 'amqplib/callback_api';
import {
  MESSAGINGDESTINATIONKINDVALUES_TOPIC,
  SEMATTRS_MESSAGING_DESTINATION,
  SEMATTRS_MESSAGING_DESTINATION_KIND,
  SEMATTRS_MESSAGING_PROTOCOL,
  SEMATTRS_MESSAGING_PROTOCOL_VERSION,
  SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY,
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_URL,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '@opentelemetry/semantic-conventions';
import { Baggage, context, propagation, SpanKind } from '@opentelemetry/api';
import { asyncConfirmSend, asyncConsume, shouldTest } from './utils';
import {
  censoredUrl,
  rabbitMqUrl,
  TEST_RABBITMQ_HOST,
  TEST_RABBITMQ_PORT,
} from './config';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';

const msgPayload = 'payload from test';
const queueName = 'queue-name-from-unittest';

describe('amqplib instrumentation callback model', () => {
  let conn: amqpCallback.Connection;
  before(() => {
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [
          new W3CBaggagePropagator(),
          new W3CTraceContextPropagator(),
        ],
      })
    );
  });
  before(function (done) {
    if (!shouldTest) {
      this.skip();
    } else {
      amqpCallback.connect(rabbitMqUrl, (err, connection) => {
        conn = connection;
        done(err);
      });
    }
  });
  after(done => {
    if (!shouldTest) {
      done();
    } else {
      conn.close(() => done());
    }
  });

  describe('channel', () => {
    let channel: amqpCallback.Channel;
    beforeEach(done => {
      conn.createChannel(
        context.bind(context.active(), (err, c) => {
          channel = c;
          // install an error handler, otherwise when we have tests that create error on the channel,
          // it throws and crash process
          channel.on('error', () => {});
          channel.assertQueue(
            queueName,
            { durable: false },
            context.bind(context.active(), (err, ok) => {
              channel.purgeQueue(
                queueName,
                context.bind(context.active(), (err, ok) => {
                  done();
                })
              );
            })
          );
        })
      );
    });

    afterEach(done => {
      try {
        channel.close(err => {
          done();
        });
      } catch {}
    });

    it('simple publish and consume from queue callback', done => {
      const hadSpaceInBuffer = channel.sendToQueue(
        queueName,
        Buffer.from(msgPayload)
      );
      expect(hadSpaceInBuffer).toBeTruthy();

      asyncConsume(
        channel,
        queueName,
        [msg => expect(msg.content.toString()).toEqual(msgPayload)],
        {
          noAck: true,
        }
      ).then(() => {
        const [publishSpan, consumeSpan] = getTestSpans();

        // assert publish span
        expect(publishSpan.name).toMatch('publish <default>');
        expect(publishSpan.kind).toEqual(SpanKind.PRODUCER);
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
          'rabbitmq'
        );
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]).toEqual(
          ''
        ); // according to spec: "This will be an empty string if the default exchange is used"
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
        ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
        ).toEqual(queueName);
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
          'AMQP'
        );
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
        ).toEqual('0.9.1');
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
          censoredUrl
        );
        expect(publishSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
          TEST_RABBITMQ_HOST
        );
        expect(publishSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
          TEST_RABBITMQ_PORT
        );

        // assert consume span
        expect(consumeSpan.kind).toEqual(SpanKind.CONSUMER);
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
          'rabbitmq'
        );
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]).toEqual(
          ''
        ); // according to spec: "This will be an empty string if the default exchange is used"
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
        ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
        ).toEqual(queueName);
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
          'AMQP'
        );
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
        ).toEqual('0.9.1');
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
          censoredUrl
        );
        expect(consumeSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
          TEST_RABBITMQ_HOST
        );
        expect(consumeSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
          TEST_RABBITMQ_PORT
        );

        // assert context propagation
        expect(consumeSpan.spanContext().traceId).toEqual(
          publishSpan.spanContext().traceId
        );
        expect(consumeSpan.parentSpanContext?.spanId).toEqual(
          publishSpan.spanContext().spanId
        );

        done();
      });
    });

    it('baggage is available while consuming', done => {
      const baggageContext = propagation.setBaggage(
        context.active(),
        propagation.createBaggage({
          key1: { value: 'value1' },
        })
      );
      context.with(baggageContext, () => {
        channel.sendToQueue(queueName, Buffer.from(msgPayload));
        let extractedBaggage: Baggage | undefined;
        asyncConsume(
          channel,
          queueName,
          [
            msg => {
              extractedBaggage = propagation.getActiveBaggage();
            },
          ],
          {
            noAck: true,
          }
        ).then(() => {
          expect(extractedBaggage).toBeDefined();
          expect(extractedBaggage!.getEntry('key1')).toBeDefined();
          done();
        });
      });
    });

    it('end span with ack sync', done => {
      channel.sendToQueue(queueName, Buffer.from(msgPayload));

      asyncConsume(channel, queueName, [msg => channel.ack(msg)]).then(() => {
        // assert consumed message span has ended
        expect(getTestSpans().length).toBe(2);
        done();
      });
    });

    it('end span with ack async', done => {
      channel.sendToQueue(queueName, Buffer.from(msgPayload));

      asyncConsume(channel, queueName, [
        msg =>
          setTimeout(() => {
            channel.ack(msg);
            expect(getTestSpans().length).toBe(2);
            done();
          }, 1),
      ]);
    });
  });

  describe('confirm channel', () => {
    let confirmChannel: amqpCallback.ConfirmChannel;
    beforeEach(done => {
      conn.createConfirmChannel(
        context.bind(context.active(), (err, c) => {
          confirmChannel = c;
          // install an error handler, otherwise when we have tests that create error on the channel,
          // it throws and crash process
          confirmChannel.on('error', () => {});
          confirmChannel.assertQueue(
            queueName,
            { durable: false },
            context.bind(context.active(), (err, ok) => {
              confirmChannel.purgeQueue(
                queueName,
                context.bind(context.active(), (err, ok) => {
                  done();
                })
              );
            })
          );
        })
      );
    });

    afterEach(done => {
      try {
        confirmChannel.close(err => {
          done();
        });
      } catch {}
    });

    it('simple publish and consume from queue callback', done => {
      asyncConfirmSend(confirmChannel, queueName, msgPayload).then(() => {
        asyncConsume(
          confirmChannel,
          queueName,
          [msg => expect(msg.content.toString()).toEqual(msgPayload)],
          {
            noAck: true,
          }
        ).then(() => {
          const [publishSpan, consumeSpan] = getTestSpans();

          // assert publish span
          expect(publishSpan.kind).toEqual(SpanKind.PRODUCER);
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
            'rabbitmq'
          );
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]
          ).toEqual(''); // according to spec: "This will be an empty string if the default exchange is used"
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
          ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
          ).toEqual(queueName);
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
            'AMQP'
          );
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
          ).toEqual('0.9.1');
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
            censoredUrl
          );
          expect(publishSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
            TEST_RABBITMQ_HOST
          );
          expect(publishSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
            TEST_RABBITMQ_PORT
          );

          // assert consume span
          expect(consumeSpan.kind).toEqual(SpanKind.CONSUMER);
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
            'rabbitmq'
          );
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]
          ).toEqual(''); // according to spec: "This will be an empty string if the default exchange is used"
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
          ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
          ).toEqual(queueName);
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
            'AMQP'
          );
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
          ).toEqual('0.9.1');
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
            censoredUrl
          );
          expect(consumeSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
            TEST_RABBITMQ_HOST
          );
          expect(consumeSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
            TEST_RABBITMQ_PORT
          );

          // assert context propagation
          expect(consumeSpan.spanContext().traceId).toEqual(
            publishSpan.spanContext().traceId
          );
          expect(consumeSpan.parentSpanContext?.spanId).toEqual(
            publishSpan.spanContext().spanId
          );

          done();
        });
      });
    });

    it('end span with ack sync', done => {
      asyncConfirmSend(confirmChannel, queueName, msgPayload).then(() => {
        asyncConsume(confirmChannel, queueName, [
          msg => confirmChannel.ack(msg),
        ]).then(() => {
          // assert consumed message span has ended
          expect(getTestSpans().length).toBe(2);
          done();
        });
      });
    });

    it('end span with ack async', done => {
      asyncConfirmSend(confirmChannel, queueName, msgPayload).then(() => {
        asyncConsume(confirmChannel, queueName, [
          msg =>
            setTimeout(() => {
              confirmChannel.ack(msg);
              expect(getTestSpans().length).toBe(2);
              done();
            }, 1),
        ]);
      });
    });
  });

  describe('channel with links config', () => {
    let channel: amqpCallback.Channel;
    beforeEach(done => {
      instrumentation.setConfig({
        useLinksForConsume: true,
      });
      conn.createChannel(
        context.bind(context.active(), (err, c) => {
          channel = c;
          // install an error handler, otherwise when we have tests that create error on the channel,
          // it throws and crash process
          channel.on('error', () => {});
          channel.assertQueue(
            queueName,
            { durable: false },
            context.bind(context.active(), (err, ok) => {
              channel.purgeQueue(
                queueName,
                context.bind(context.active(), (err, ok) => {
                  done();
                })
              );
            })
          );
        })
      );
    });

    afterEach(done => {
      try {
        channel.close(err => {
          done();
        });
      } catch {}
    });

    it('simple publish and consume from queue callback', done => {
      const hadSpaceInBuffer = channel.sendToQueue(
        queueName,
        Buffer.from(msgPayload)
      );
      expect(hadSpaceInBuffer).toBeTruthy();

      asyncConsume(
        channel,
        queueName,
        [msg => expect(msg.content.toString()).toEqual(msgPayload)],
        {
          noAck: true,
        }
      ).then(() => {
        const [publishSpan, consumeSpan] = getTestSpans();

        // assert publish span
        expect(publishSpan.kind).toEqual(SpanKind.PRODUCER);
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
          'rabbitmq'
        );
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]).toEqual(
          ''
        ); // according to spec: "This will be an empty string if the default exchange is used"
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
        ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
        ).toEqual(queueName);
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
          'AMQP'
        );
        expect(
          publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
        ).toEqual('0.9.1');
        expect(publishSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
          censoredUrl
        );
        expect(publishSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
          TEST_RABBITMQ_HOST
        );
        expect(publishSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
          TEST_RABBITMQ_PORT
        );

        // assert consume span
        expect(consumeSpan.kind).toEqual(SpanKind.CONSUMER);
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
          'rabbitmq'
        );
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]).toEqual(
          ''
        ); // according to spec: "This will be an empty string if the default exchange is used"
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
        ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
        ).toEqual(queueName);
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
          'AMQP'
        );
        expect(
          consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
        ).toEqual('0.9.1');
        expect(consumeSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
          censoredUrl
        );
        expect(consumeSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
          TEST_RABBITMQ_HOST
        );
        expect(consumeSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
          TEST_RABBITMQ_PORT
        );

        // new trace should be created
        expect(consumeSpan.spanContext().traceId).not.toEqual(
          publishSpan.spanContext().traceId
        );
        expect(consumeSpan.parentSpanContext?.spanId).toBeUndefined();

        // link back to publish span
        expect(consumeSpan.links.length).toBe(1);
        expect(consumeSpan.links[0].context.traceId).toEqual(
          publishSpan.spanContext().traceId
        );
        expect(consumeSpan.links[0].context.spanId).toEqual(
          publishSpan.spanContext().spanId
        );

        done();
      });
    });
  });

  describe('confirm channel with links config', () => {
    let confirmChannel: amqpCallback.ConfirmChannel;
    beforeEach(done => {
      instrumentation.setConfig({
        useLinksForConsume: true,
      });
      conn.createConfirmChannel(
        context.bind(context.active(), (err, c) => {
          confirmChannel = c;
          // install an error handler, otherwise when we have tests that create error on the channel,
          // it throws and crash process
          confirmChannel.on('error', () => {});
          confirmChannel.assertQueue(
            queueName,
            { durable: false },
            context.bind(context.active(), (err, ok) => {
              confirmChannel.purgeQueue(
                queueName,
                context.bind(context.active(), (err, ok) => {
                  done();
                })
              );
            })
          );
        })
      );
    });

    afterEach(done => {
      try {
        confirmChannel.close(err => {
          done();
        });
      } catch {}
    });

    it('simple publish and consume from queue callback', done => {
      asyncConfirmSend(confirmChannel, queueName, msgPayload).then(() => {
        asyncConsume(
          confirmChannel,
          queueName,
          [msg => expect(msg.content.toString()).toEqual(msgPayload)],
          {
            noAck: true,
          }
        ).then(() => {
          const [publishSpan, consumeSpan] = getTestSpans();

          // assert publish span
          expect(publishSpan.kind).toEqual(SpanKind.PRODUCER);
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
            'rabbitmq'
          );
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]
          ).toEqual(''); // according to spec: "This will be an empty string if the default exchange is used"
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
          ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
          ).toEqual(queueName);
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
            'AMQP'
          );
          expect(
            publishSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
          ).toEqual('0.9.1');
          expect(publishSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
            censoredUrl
          );
          expect(publishSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
            TEST_RABBITMQ_HOST
          );
          expect(publishSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
            TEST_RABBITMQ_PORT
          );

          // assert consume span
          expect(consumeSpan.kind).toEqual(SpanKind.CONSUMER);
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_SYSTEM]).toEqual(
            'rabbitmq'
          );
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION]
          ).toEqual(''); // according to spec: "This will be an empty string if the default exchange is used"
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_DESTINATION_KIND]
          ).toEqual(MESSAGINGDESTINATIONKINDVALUES_TOPIC);
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY]
          ).toEqual(queueName);
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL]).toEqual(
            'AMQP'
          );
          expect(
            consumeSpan.attributes[SEMATTRS_MESSAGING_PROTOCOL_VERSION]
          ).toEqual('0.9.1');
          expect(consumeSpan.attributes[SEMATTRS_MESSAGING_URL]).toEqual(
            censoredUrl
          );
          expect(consumeSpan.attributes[SEMATTRS_NET_PEER_NAME]).toEqual(
            TEST_RABBITMQ_HOST
          );
          expect(consumeSpan.attributes[SEMATTRS_NET_PEER_PORT]).toEqual(
            TEST_RABBITMQ_PORT
          );

          // new trace should be created
          expect(consumeSpan.spanContext().traceId).not.toEqual(
            publishSpan.spanContext().traceId
          );
          expect(consumeSpan.parentSpanContext?.spanId).toBeUndefined();

          // link back to publish span
          expect(consumeSpan.links.length).toBe(1);
          expect(consumeSpan.links[0].context.traceId).toEqual(
            publishSpan.spanContext().traceId
          );
          expect(consumeSpan.links[0].context.spanId).toEqual(
            publishSpan.spanContext().spanId
          );

          done();
        });
      });
    });
  });
});
