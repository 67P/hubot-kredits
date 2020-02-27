const fetch = require('node-fetch');

module.exports = async function(robot, kredits) {

  function createContributionFor (participant, meeting) {
    // TODO
  }

  function getContributorByZoomUserId(userId) {
    return Contributor.findByAccount({ zoomId: userId });
  }

  function getMeetingParticipants(meetingUUID) {
    fetch(`https://api.zoom.us/v2/past_meetings/${meetingUUID}/participants`)
      .then(response => response.json())
      .then(json => json.participants)
  }

  function handleZoomMeetingEnded(data) {
    const meetingUUID = data.uuid;
    const topic = data.topic;
    const duration = data.duration;

    const meeting = {
      // TODO
    }

    if (duration < 15) {
      robot.logger.info('[hubot-kredits] ignoring short calls');
      return;
    }
    const participants = await getMeetingParticipants(meetingUUID);
    participants.forEach(p => {
      createContributionFor(p, meeting);
    });
  }

  robot.router.post('/incoming/kredits/zoom'+process.env.KREDITS_WEBHOOK_TOKEN), (req, res) => {
    let data = req.body;
    const eventName = data.event;
    const payload = data.payload;

    if (eventName === 'meeting.ended') {
      handleZoomMeetingEnded(payload);
    }

    res.sendStatus(200);
  })
}
