function verifyGmailConnectivity() {
  try {
    Gmail.Users.Labels.list('me', {fields: 'labels/type'});
    console.log('Gmail read probe succeeded; no message content requested.');
  } catch (_) {
    throw new Error('Gmail read probe failed; provider details suppressed.');
  }
}

function verifyMessageRetrieval() {
  try {
    const deadline = Date.now() + 240000;
    function list(q) {
      const ids = new Set();
      let pageToken;
      let pages = 0;
      do {
        if (Date.now() > deadline || pages >= 20) throw new Error();
        const page = Gmail.Users.Messages.list('me', {
          q, maxResults: 100, includeSpamTrash: true, pageToken,
          fields: 'messages/id,nextPageToken'
        });
        for (const message of page.messages || []) ids.add(message.id);
        pageToken = page.nextPageToken;
        pages++;
      } while (pageToken);
      return {ids, pages};
    }
    const history = list('');
    const purchases = list('category:purchases');
    let retrieved = 0;
    let bodies = 0;
    let attachments = 0;
    for (const id of purchases.ids) {
      if (Date.now() > deadline) throw new Error();
      const message = Gmail.Users.Messages.get('me', id, {format: 'full'});
      if (!message.payload) throw new Error();
      const pending = [message.payload];
      while (pending.length) {
        const part = pending.pop();
        if (part.body && part.body.data) bodies++;
        if (part.body && part.body.attachmentId) attachments++;
        pending.push(...(part.parts || []));
      }
      retrieved++;
    }
    console.log(JSON.stringify({
      historyMessages: history.ids.size, historyPages: history.pages,
      purchaseCandidates: purchases.ids.size, retrieved, bodies, attachments
    }));
  } catch (_) {
    throw new Error('Message probe incomplete; provider details suppressed.');
  }
}
