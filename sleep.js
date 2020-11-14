const Sleep = async (timeout) => {
    return new Promise(resolve => {
        setTimeout(() => {
            return resolve();
        }, timeout);
    })
}

module.exports = {
    Sleep
}