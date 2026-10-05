/* Disaster Lens – DEMO DATA (development only)
 *
 * This is the ONLY place sample records are created. It runs only when someone
 * deliberately opens Demo mode, and it fills a completely separate database
 * (dl_demo_v2). The real database never receives any of this.
 *
 * To remove demo data from a build: delete this file and its <script> tag.
 * Everything is clearly labelled: names start with "Demo", titles start with
 * "[Demo]", and every record carries demo: true.
 */
(function () {
  window.DL = window.DL || {};

  window.DL.demoSeed = function (h) {
    var DAY = 86400000;
    var PASSWORD = 'Demo@12345';

    return h.hash(PASSWORD, 'demo-salt').then(function (ph) {
      var t = h.now();
      var d = h.emptyDb(true);

      function user(id, role, name, email, extra) {
        var u = { id: id, role: role, name: name, email: email, phone: '', passwordHash: ph, salt: 'demo-salt', state: 'Uttar Pradesh', district: 'Demo District', city: 'Demo City',
          pincode: '', createdAt: t - 30 * DAY, account: { status: 'active', until: null, reason: '', by: '' }, modHistory: [], demo: true };
        Object.keys(extra || {}).forEach(function (k) { u[k] = extra[k]; });
        d.users.push(u);
      }
      user('demo_admin', 'admin', 'Demo Admin', 'admin@demo.local');
      user('demo_official', 'official', 'Demo Official', 'official@demo.local', { authorityRole: 'District Officer', deptId: 'works', idProof: 'Demo ID 0001',
        verification: { status: 'approved', submittedAt: t - 20 * DAY, history: [{ ts: t - 19 * DAY, status: 'approved', by: 'Demo Admin', note: 'Demo ID checked' }], supporting: [], adminNote: '' } });
      user('demo_pending', 'official', 'Demo Pending Official', 'pending@demo.local', { authorityRole: 'Ward Officer', deptId: 'water', idProof: 'Demo ID 0002',
        verification: { status: 'pending', submittedAt: t - 1 * DAY, history: [{ ts: t - 1 * DAY, status: 'pending', by: 'applicant', note: 'Application sent' }], supporting: [], adminNote: '' } });
      user('demo_citizen', 'citizen', 'Demo Citizen', 'citizen@demo.local');
      user('demo_nb_a', 'citizen', 'Demo Neighbour A', 'neighbour.a@demo.local');
      user('demo_nb_b', 'citizen', 'Demo Neighbour B', 'neighbour.b@demo.local');

      var rows = [
        ['road', '[Demo] Deep potholes on the main road', 'Several deep potholes near the crossing. Two-wheelers are skidding every day.', 'Demo crossing', 'In progress', 4, 12],
        ['water', '[Demo] Open drain overflowing near primary school', 'Dirty water is flowing onto the footpath where children walk to school.', 'Demo school lane', 'Submitted', 2, 9],
        ['power', '[Demo] Live wire hanging low after storm', 'An electric wire is hanging at head height and sparking near the bus stop.', 'Demo bus stop', 'Submitted', 0, 31],
        ['waste', '[Demo] Garbage not collected for ten days', 'The garbage van has not come to our lane. Waste is piling up next to the tap.', 'Demo lane 4', 'Resolved', 3, 5],
        ['flood', '[Demo] Waterlogging blocks the underpass', 'Knee-deep water in the underpass after one hour of rain. Cars are stalling.', 'Demo underpass', 'Submitted', 1, 22],
        ['power', '[Demo] Street light report with an unclear location', 'The street light is not working but the place described could be in two different areas.', 'Demo market', 'Submitted', 0, 3]
      ];
      rows.forEach(function (r, i) {
        var id = 101 + i, ts = t - r[5] * DAY - 3600000;
        var p = h.detectPriority(r[1], r[2], r[0]);
        var dept = { road: 'works', water: 'water', power: 'electricity', waste: 'sanitation', flood: 'disaster' }[r[0]];
        var days = { road: 7, water: 5, power: 2, waste: 5, flood: 1 }[r[0]];
        var tl = [{ ts: ts, label: 'Report submitted' }];
        var resp = '', officer = '';
        if (r[4] === 'In progress' || r[4] === 'Resolved') { tl.push({ ts: ts + 5 * 3600000, label: 'Work started by ' + dept + ' (Demo Official)' }); officer = 'demo_official'; }
        if (r[4] === 'Resolved') { tl.push({ ts: ts + 2 * DAY, label: 'Marked resolved by ' + dept + ' (Demo Official)' }); resp = 'Garbage was cleared from the lane and the route was corrected.'; }
        d.complaints.push({
          id: id, clientUuid: h.uid('c'), citizenId: 'demo_citizen', isAnonymous: false, category: r[0], title: r[1], description: r[2], state: 'Uttar Pradesh', district: 'Demo District', city: 'Demo City',
          pincode: '', manualLocationAddress: r[3], latitude: null, longitude: null, imageUrlProof: '', status: r[4], priority: p.priority, priorityReason: p.reason, deptId: dept,
          slaDeadlineDays: p.priority === 'Urgent' ? 1 : days, upvoteCount: r[6], flagCount: 0, isEscalated: false, authorityResponse: resp, resolutionProofUrl: '', assignedOfficerId: officer,
          modStatus: 'normal', modOutcome: '', modReason: '', duplicateOf: null, modLog: [], timestamp: ts, dateUpdated: ts, timeline: tl, demo: true
        });
      });
      // sample map positions (fictional reports placed around one city centre). Report 105 has no GPS on purpose,
      // so the "not on the map" and "approximate area" cases can be tried.
      var spots = [[26.8530, 80.9490], [26.8395, 80.9340], [26.8580, 80.9280], [26.8310, 80.9610], null, [26.8450, 80.9570]];
      d.complaints.forEach(function (c, i) {
        c.locationPrivacy = 'approximate';
        if (spots[i]) { c.latitude = spots[i][0]; c.longitude = spots[i][1]; } else { c.city = 'Lucknow'; }
      });
      d.seq = 200;

      // one flagged report so the moderation screens have something to show (flags are NOT a decision)
      var flagged = d.complaints[5];
      flagged.flagCount = 2; flagged.modStatus = 'flagged';
      d.flags.push({ id: h.uid('f'), userId: 'demo_nb_a', complaintId: flagged.id, reasonId: 'wrong_location', note: 'This looks like a different street.', ts: t - 6 * 3600000 });
      d.flags.push({ id: h.uid('f'), userId: 'demo_nb_b', complaintId: flagged.id, reasonId: 'duplicate', note: '', ts: t - 3 * 3600000 });
      d.audit = [];
      return d;
    });
  };
  window.DL.demoPassword = 'Demo@12345';
})();
