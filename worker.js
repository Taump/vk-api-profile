const axios = require('axios');
const redis = require("ioredis");
const socket = require('socket.io-client');
const mysql = require('mysql2');
const moment = require('moment');
const { Sleep } = require('./sleep');
const event = require('events');
const { profile } = require('console');

const EVENT_PREFIX = 'get-vk-profile::';

const events = new event();
events.setMaxListeners(10000);

const access_token = "afbec72aafbec72aafbec72aa5afdbb2d5aafbeafbec72af4df146e7898dd2335010735";
const vkLoop = [];

const cache = redis.createClient();
const client = socket.connect('http://localhost:5057', {
    query: {
        access: 'd41d8cd98f00b204e9800998ecf8427e'
    }
});

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'vkdb',
    password: "example"
}).promise();

client.on('getProfile', async (data) => {
    const { taskID, params } = data;
    const { userId } = params;


    const profile = await getProfile(userId);

    client.emit('execute', {
        taskID,
        state: {
            type: "data",
            data: profile
        }
    });


});


client.on('successful', (data) => {
    console.log(data.at, 'Worker successful connected');
});

client.on('disconnect', function () {
    console.log('Worker disconnect');
});

const getProfile = async (id) => {
    const callback = new Promise(resolve => {
        events.once(`${EVENT_PREFIX}${id}`, (profile) => {
            return resolve(profile);
        });
    });

    vkLoop.push(id);
    return callback;
};


const getProfilesFromCache = async (ids) => {
    const getProfilesFromCache = ids.map((id) => cache.get(id));
    return Promise.all(getProfilesFromCache)
        .then((profiles) => profiles.filter((profile) => !!profile))
        .then((strProfiles) => strProfiles.map((strProfile) => JSON.parse(strProfile)));
}

const getProfilesFromDB = async (ids) => {
    if (!ids.length) return [];

    const date = moment();

    date.set({
        date: date.get('date') - 1
    });

    const previousDate = date.format('YYYY-MM-DD');

    const [rows] = await db.query('SELECT vk_id as id, first_name, last_name, photo, create_at FROM users WHERE vk_id IN (?) AND create_at > ?', [ids, previousDate]);
    return rows;
}

const getActualProfiles = async (ids) => {
    const profilesFromCache = await getProfilesFromCache(ids);
    const profilesFromCacheId = profilesFromCache.map((profile) => profile.id);
    const idsNotIncludesInCache = ids.filter((id) => !profilesFromCacheId.includes(id))
    const profilesFromDB = await getProfilesFromDB(idsNotIncludesInCache);
    return [...profilesFromCache, ...profilesFromDB];
}

const deleteDuplicatedIds = (ids) => {
    return ids.reduce((acc, current) => {
        if (!acc.includes(current)) {
            acc.push(current)
        }
        return acc
    }, [])
}
const updateCache = async (profiles) => {
    return profiles.map((profile) => {
        const profileStr = JSON.stringify(profile);
        return cache.set(profile.id, profileStr)
    });
}

const update = async () => {
    while (true) {
        await Sleep(2000);

        const profileIds = deleteDuplicatedIds(vkLoop.splice(0, 20));

        if (!profileIds.length) {
            continue;
        }

        const actualProfiles = await getActualProfiles(profileIds)

        const groupIds = actualProfiles.map(({ id }) => id);

        const profileIdsParam = profileIds
            .filter(id => !groupIds.includes(Number(id)))
            .join(',');

        const { data } = await axios.get(`https://api.vk.com/method/users.get?user_ids=${profileIdsParam}&fields=photo_50&access_token=${access_token}&v=5.21`);

        const profiles = [
            ...data.response,
            ...actualProfiles
        ];

        const transactionDb = await db.getConnection();
        try {
            const profilesToDb = [];

            await transactionDb.beginTransaction();
            for (const profile of data.response) {
                const execute = transactionDb.execute(`
                    REPLACE INTO users 
                        (vk_id, first_name, last_name, photo, create_at) 
                    VALUES(?, ?, ?, ?, ?)
                `, [
                    profile.id,
                    profile.first_name,
                    profile.last_name,
                    profile.photo_50,
                    new Date()
                ]);

                profilesToDb.push(execute);
            }

            const cachedProfiles = updateCache(profiles);

            await Promise.all([profilesToDb, cachedProfiles]);
            await transactionDb.commit();

            profiles.forEach((profile) =>
                events.emit(`${EVENT_PREFIX}${profile.id}`, profile));

        } catch (e) {
            console.log("error", e);
            await transactionDb.rollback();
        } finally {
            transactionDb.release();
        }
    }
};

update();