const fetch = require('node-fetch');

module.exports = async function(robot, kredits) {
  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;

  const kreditsContributionAmount = 500;
  const kreditsContributionKind = 'community';

  const zoomAccessToken = process.env.KREDITS_ZOOM_JWT;

  const walletTransactionCount = await kredits.provider.getTransactionCount(kredits.signer.address);
  let nonce = walletTransactionCount;

  function createContributionFor(participant, meeting) {
    const displayName = participant.name;

    return getContributorByZoomDisplayName(displayName)
      .then(contributor => {
        let contribution = {
          contributorId: contributor.id,
          contributorIpfsHash: contributor.ipfsHash,
          amount: kreditsContributionAmount,
          kind: kreditsContributionKind,
          description: `Team meeting: ${meeting.topic}`,
          date: meeting.end_time.split('T')[0],
          time: meeting.end_time.split('T')[1]
        }

        return Contribution.addContribution(contribution, { nonce: nonce++ })
          .catch(error => {
            robot.logger.error(`[hubot-kredits] Adding contribution failed:`, error);
          });
      })
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

    if (meetingDetails.duration < 15 || meetingDetails.participants_count < 3) {
      robot.logger.info(`[hubot-kredits] ignoring meeting: uuid:${data.uuid} duration:${meetingDetails.duration} participants_count:${meetingDetails.participants_count}`);
      return;
    }
    participants.forEach(p => {
      createContributionFor(p, meetingDetails)
        .then(tx => {
          robot.logger.info(`[hubot-kredits] contribution created: ${tx.hash}`);
        })
    });
  }

  robot.router.post('/incoming/kredits/zoom/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    let data = req.body;
    const eventName = data.event;
    const payload = data.payload;
    const object = payload.object;

    if (eventName === 'meeting.ended') {
      handleZoomMeetingEnded(object);
    }

    res.sendStatus(200);
  })
}
