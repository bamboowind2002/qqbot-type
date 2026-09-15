function callbackOperation(invoke) {
    return new Promise((resolve, reject) => {
        invoke((err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

async function closeConnection(connection) {
    await callbackOperation(done => connection.end(done));
}

export async function runMysqlTransaction(connectionFactory, operation) {
    const connection = connectionFactory();
    let connected = false;
    let transactionStarted = false;
    try {
        await callbackOperation(done => connection.connect(done));
        connected = true;
        await callbackOperation(done => connection.beginTransaction(done));
        transactionStarted = true;
        const result = await operation((sql, values) =>
            callbackOperation(done => connection.query(sql, values, done))
        );
        await callbackOperation(done => connection.commit(done));
        transactionStarted = false;
        try {
            await closeConnection(connection);
        } catch (_) {
            // The transaction is already committed; a close error must not
            // turn a successful ownership change into a false failure.
            if (typeof connection.destroy === 'function') connection.destroy();
        }
        connected = false;
        return result;
    } catch (err) {
        if (transactionStarted) {
            try {
                await callbackOperation(done => connection.rollback(done));
            } catch (_) {
                // Preserve the original transaction error.
            }
        }
        if (connected) {
            try {
                await closeConnection(connection);
            } catch (_) {
                // Preserve the original transaction error.
            }
        } else if (typeof connection.destroy === 'function') {
            connection.destroy();
        }
        throw err;
    }
}
