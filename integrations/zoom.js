const fetch = require('node-fetch');

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  const { Contributor, Contribution } = kredits;

  const kreditsContributionAmount = 500;
  const kreditsContributionKind = 'community';

  const zoomAccessToken = process.env.KREDITS_ZOOM_JWT;

  const walletTransactionCount = await kredits.provider.getTransactionCount(kredits.signer.address);
  let nonce = walletTransactionCount;

  async function createContributionFor (displayName, meeting) {
    const contributor = await getContributorByZoomDisplayName(displayName);

    if (!contributor) {
      robot.logger.info(`[hubot-kredits] Contributor not found: Zoom display name: ${displayName}`);
      messageRoom(`I tried to add a contribution for zoom user ${displayName}, but did not find a matching contributor profile.`);
      return Promise.resolve();
    }

    const contribution = {
      contributorId: contributor.id,
      contributorIpfsHash: contributor.ipfsHash,
      amount: kreditsContributionAmount,
      kind: kreditsContributionKind,
      description: 'Team/Community Call',
      date: meeting.end_time.split('T')[0],
      time: meeting.end_time.split('T')[1]
    }

    return Contribution.add(contribution, { nonce: nonce++ })
      .then(tx => {
        robot.logger.info(`[hubot-kredits] Contribution created: ${tx.hash}`);
      })
      .catch(error => {
        robot.logger.error(`[hubot-kredits] Adding contribution for Zoom call failed:`, error);
      });
  }

  function getContributorByZoomDisplayName(displayName) {
    return Contributor.findByAccount({ site: 'zoom.us', username: displayName });
  }

  function request(path) {
    return fetch(
      `https://api.zoom.us/v2${path}`,
      {headers: {authorization: `Bearer ${zoomAccessToken}`}}
    );
  }

  function getMeetingParticipants(meetingUUID) {
    return request(`/past_meetings/${meetingUUID}/participants`)
      .then(response => response.json())
      .then(json => json.participants)
  }

  function getMeetingDetails(meetingUUID) {
    return request(`/past_meetings/${meetingUUID}`)
      .then(r => r.json());
  }

  async function handleZoomMeetingEnded(data) {
    const meetingDetails = await getMeetingDetails(data.uuid);
    const participants = await getMeetingParticipants(data.uuid);
    const names = Array.from(new Set(participants.map(p => p.name)));

    if (meetingDetails.duration < 15 || names.length < 3) {
      robot.logger.info(`[hubot-kredits] Ignoring zoom call ${data.uuid} (duration: ${meetingDetails.duration}, participants_count: ${meetingDetails.participants_count})`);
      return;
    }

    for (const displayName of names) {
      await createContributionFor(displayName, meetingDetails);
    };
  }

  robot.router.post('/incoming/kredits/zoom/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    let data = req.body;
    const eventName = data.event;
    const payload = data.payload;
    const object = payload.object;


    if (eventName === 'meeting.ended' && (
        process.env.KREDITS_ZOOM_MEETING_WHITELIST?.split(',').includes(object.id)
      )) {
      handleZoomMeetingEnded(object);
    }

    res.sendStatus(200);
  })
}
