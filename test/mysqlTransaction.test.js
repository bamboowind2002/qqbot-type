import test from 'node:test';
import assert from 'node:assert/strict';

import { runMysqlTransaction } from '../dist/mysqlTransaction.js';

function fakeConnection({ failQueryAt = null, failEnd = false } = {}) {
    const events = [];
    let queryCount = 0;
    const connection = {
        events,
        connect(done) {
            events.push('connect');
            done(null);
        },
        beginTransaction(done) {
            events.push('begin');
            done(null);
        },
        query(sql, values, done) {
            queryCount += 1;
            events.push(['query', sql, values]);
            if (queryCount === failQueryAt) done(new Error('query failed'));
            else done(null, { affectedRows: 1 });
        },
        commit(done) {
            events.push('commit');
            done(null);
        },
        rollback(done) {
            events.push('rollback');
            done(null);
        },
        end(done) {
            events.push('end');
            done(failEnd ? new Error('end failed') : null);
        },
        destroy() {
            events.push('destroy');
        }
    };
    return connection;
}

test('transaction helper commits all statements and closes its dedicated connection', async () => {
    const connection = fakeConnection();
    const result = await runMysqlTransaction(() => connection, async query => {
        await query('first statement', ['one']);
        await query('second statement', ['two']);
        return 'done';
    });
    assert.equal(result, 'done');
    assert.deepEqual(connection.events.map(event => Array.isArray(event) ? event[0] : event), [
        'connect', 'begin', 'query', 'query', 'commit', 'end'
    ]);
});

test('transaction helper rolls back when a statement fails', async () => {
    const connection = fakeConnection({ failQueryAt: 2 });
    await assert.rejects(
        runMysqlTransaction(() => connection, async query => {
            await query('first statement');
            await query('second statement');
        }),
        /query failed/
    );
    assert.deepEqual(connection.events.map(event => Array.isArray(event) ? event[0] : event), [
        'connect', 'begin', 'query', 'query', 'rollback', 'end'
    ]);
});

test('connection close failure does not misreport an already committed transaction', async () => {
    const connection = fakeConnection({ failEnd: true });
    await assert.doesNotReject(runMysqlTransaction(() => connection, async query => {
        await query('statement');
    }));
    assert.equal(connection.events.includes('commit'), true);
    assert.equal(connection.events.includes('rollback'), false);
    assert.equal(connection.events.includes('destroy'), true);
});
