const STATE_NAMES = {
    IA: 'Iowa',
    WI: 'Wisconsin',
    AZ: 'Arizona'
};
function integer(v) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw Error("Invalid utility customer count");
    return v;
}
function sourceTime(value, now) {
    const age = +now - Date.parse(String(value));
    if (typeof value !== "string" || !Number.isFinite(age) || age < -300000) throw Error("Invalid utility timestamp");
    return {
        updatedAt: value,
        fresh: age <= 1800000
    };
}
export function localPublicationTime(year, month, day, hour, minute, second, zone) {
    const clock = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    let epoch = target;
    for(let pass = 0; pass < 3; pass++){
        const parts = Object.fromEntries(clock.formatToParts(new Date(epoch)).map((p)=>[
                p.type,
                p.value
            ]));
        const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        epoch += target - actual;
    }
    const p = Object.fromEntries(clock.formatToParts(new Date(epoch)).map((p)=>[
            p.type,
            p.value
        ]));
    if (Number(p.year) !== year || Number(p.month) !== month || Number(p.day) !== day || Number(p.hour) !== hour || Number(p.minute) !== minute || Number(p.second) !== second) throw Error('Invalid local publication date');
    return new Date(epoch).toISOString();
}
function result(feed, customers, time, message, checked = false, accounts) {
    return {
        components: [],
        customers,
        ...time,
        timestampKind: checked ? 'checked' : undefined,
        reportingAccounts: accounts,
        stateOnlyStates: feed.states,
        stateReports: [
            {
                id: feed.id,
                name: feed.name,
                state: STATE_NAMES[feed.states[0]],
                eiaIds: feed.eiaIds,
                customers,
                customersUpper: customers,
                ...time
            }
        ],
        message
    };
}
function success(d) {
    if (d?.status?.code !== 200 || d.status.error !== false || d.status.type !== 'success') throw Error('Public utility response unavailable');
    return d.data;
}
function numericClock(value, now) {
    if (typeof value !== 'string') throw Error('Missing utility publication clock');
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!m) throw Error('Invalid UTC publication clock');
    return sourceTime(`${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}Z`, now);
}
export function parseAlliant(events, summary, feed, now) {
    const rows = success(events), s = success(summary);
    if (feed.kind !== 'alliant' || !Array.isArray(rows) || !Array.isArray(s?.outageSummaryResponse) || s.outageSummaryResponse.length !== 2) throw Error('Incomplete Alliant publication');
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s.fileDateTime);
    if (!m) throw Error('Alliant summary clock missing');
    const time = sourceTime(localPublicationTime(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], 'America/Chicago'), now);
    const totals = {
        IA: 0,
        WI: 0
    }, seen = new Set(), stamps = new Set();
    for (const e of rows){
        if (typeof e.incidentId !== 'string' || !e.incidentId || seen.has(e.incidentId) || e.outageType !== 2 || e.serviceType !== 1 || ![
            0,
            1
        ].includes(e.status) || !Array.isArray(e.affectedAreas) || !e.affectedAreas.length) throw Error('Invalid or duplicate Alliant incident');
        seen.add(e.incidentId);
        const stamp = numericClock(e.lastUpdateTime, now);
        stamps.add(stamp.updatedAt);
        const start = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(e.startTime);
        if (!start || Date.parse(localPublicationTime(+start[3], +start[1], +start[2], +start[4], +start[5], +start[6], 'America/Chicago')) > +now + 300000) throw Error('Invalid or future Alliant incident');
        if (!stamp.fresh) throw Error('Stale Alliant incident publication');
        const states = new Set();
        for (const a of e.affectedAreas){
            if (typeof a.zipCode !== 'string' || !/^\d{5}$/.test(a.zipCode)) throw Error('Alliant state identity missing');
            states.add(/^5[012]/.test(a.zipCode) ? 'IA' : /^5[34]/.test(a.zipCode) ? 'WI' : 'unknown');
        }
        if (states.size !== 1 || states.has('unknown')) throw Error('Ambiguous Alliant state');
        totals[[
            ...states
        ][0]] += integer(e.affectedCount);
    }
    if (stamps.size > 1) throw Error('Mixed Alliant incident publication');
    const seenStates = new Set();
    let accounts = 0;
    for (const a of s.outageSummaryResponse){
        if (![
            'IA',
            'WI'
        ].includes(a.state) || seenStates.has(a.state) || integer(a.accountsAffected) !== totals[a.state] || a.accountsAffected > integer(a.accountsServed)) throw Error('Alliant state/event totals disagree');
        seenStates.add(a.state);
        if (a.state === feed.states[0]) accounts = a.accountsServed;
    }
    if (!accounts) throw Error('Alliant served accounts missing');
    return result(feed, totals[feed.states[0]], time, 'Official state headlines reconcile with all current incidents using their affected-point ZIPs. Summary publication time controls freshness. State totals only.', false, accounts);
}
export function parseSrp(rows, feed, now) {
    if (feed.kind !== 'srp' || !Array.isArray(rows)) throw Error('SRP current incident list unavailable');
    const seen = new Set();
    let customers = 0;
    for (const e of rows){
        if (typeof e.outageId !== 'string' || !e.outageId || seen.has(e.outageId) || typeof e.isMaintenanceOutage !== 'boolean' || !Number.isFinite(e.latitude) || !Number.isFinite(e.longitude) || e.latitude < 32 || e.latitude > 35 || e.longitude < -113 || e.longitude > -110 || !Number.isFinite(Date.parse(e.outageBegan)) || Date.parse(e.outageBegan) > +now + 300000) throw Error('Invalid or duplicate SRP current incident');
        seen.add(e.outageId);
        customers += integer(e.numberCustomersAffected);
        integer(e.estimatedUsersImpacted);
    }
    return result(feed, customers, {
        updatedAt: now.toISOString(),
        fresh: true
    }, 'Complete official current incident list, including active maintenance. Customer accounts affected are used, not estimated people. The source has no publication clock; timestamp is when Gridwatch checked it. State total only.', true);
}
