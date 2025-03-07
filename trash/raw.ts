import { Expo, ExpoPushTicket } from "expo-server-sdk";
import * as admin from "firebase-admin";
import serviceAccount from "../firebase-server-key.json"; // Ensure this file exists

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount), // Explicit typing
  databaseURL:
    "https://pinyaxtract-default-rtdb.asia-southeast1.firebasedatabase.app",
});

// * Initialize Realtime Database and Firestore
const database = admin.database();
const firestore = admin.firestore();
// * RTDB Reference
const temperatureRef = database.ref("Temperature");
const fanRef = database.ref("Fan");
// * Threshold and States
const lowTempVal = 65;
const highTempVal = 70;
let isNormalNotified = false;

async function getExpoTokens(): Promise<string[]> {
  try {
    const usersCollection = firestore.collection("users");
    const usersSnapshot = await usersCollection.get();
    const tokensSet = new Set<string>();
    // const tokenRaw: string[] = [];

    usersSnapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      if (userData && Array.isArray(userData.expoPushTokens)) {
        userData.expoPushTokens.forEach((token: string) => {
          tokensSet.add(token);
          // tokenRaw.push(token);
        });
      }
    });

    const tokensArray = Array.from(tokensSet);
    // console.log("Expo Push Tokens:", tokensArray);
    return tokensArray;
  } catch (error) {
    console.error("Error retrieving tokens:", error);
    return [];
  }
}
// * Send Message when the Temperature is High
temperatureRef.on("value", (snapshot) => {
  const tempVal = snapshot ? snapshot.val() : 0;

  fanRef.once("value", (snapshot) => {
    const fanState = snapshot.val();

    if (tempVal >= highTempVal && !fanState) {
      //Send a Warning Notification Message

      const normalTempMessage = {
        title: "Temperature Stabilized",
        body: "The machine is now within a safe temperature range. You can restart the machine now if needed.",
      };

      isNormalNotified = false;
    }
  });
});

// * Send Message when the Temperature is Back to Normal (Only Once)
temperatureRef.on("value", (snapshot) => {
  const tempVal = snapshot ? snapshot.val() : 0;

  if (tempVal <= lowTempVal && !isNormalNotified) {
    //Send a Normalize Temp Notification Message

    const overheatingMessage = {
      title: "Overheating Alert!",
      body: "High temperature detected! Shut down machine immediately and wait 40 minutes before restarting to prevent damage.",
    };

    // sendMessage(message);
    isNormalNotified = true;
  } else {
    console.log("No Message was Sent");
  }
});

//* Send Push Notifications via Expo
// Create a new Expo SDK client
let expo = new Expo({ useFcmV1: true });

// Create the messages that you want to send to clients
let messages = [];
for (let pushToken of somePushTokens) {
  // Each push token looks like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]

  // Check that all your push tokens appear to be valid Expo push tokens
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    continue;
  }

  // Construct a message (see https://docs.expo.io/push-notifications/sending-notifications/)
  messages.push({
    to: pushToken,
    sound: "default",
    body: "This is a test notification",
    data: { withSome: "data" },
  });
}

let chunks = expo.chunkPushNotifications(messages);
let tickets: ExpoPushTicket[] = [];
(async () => {
  // Send the chunks to the Expo push notification service. There are
  // different strategies you could use. A simple one is to send one chunk at a
  // time, which nicely spreads the load out over time:
  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log(ticketChunk);
      tickets.push(...ticketChunk);
      // NOTE: If a ticket contains an error code in ticket.details.error, you
      // must handle it appropriately. The error codes are listed in the Expo
      // documentation:
      // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
    } catch (error) {
      console.error(error);
    }
  }
})();

let receiptIds = [];
for (let ticket of tickets) {
  // NOTE: Not all tickets have IDs; for example, tickets for notifications
  // that could not be enqueued will have error information and no receipt ID.
  if (ticket.status === "ok") {
    receiptIds.push(ticket.id);
  }
}

let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
(async () => {
  // Like sending notifications, there are different strategies you could use
  // to retrieve batches of receipts from the Expo service.
  for (let chunk of receiptIdChunks) {
    try {
      let receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      console.log(receipts);

      // The receipts specify whether Apple or Google successfully received the
      // notification and information about an error, if one occurred.
      for (let receiptId in receipts) {
        let { status, message, details } = receipts[receiptId];
        if (status === "ok") {
          continue;
        } else if (status === "error") {
          console.error(
            `There was an error sending a notification: ${message}`
          );
          if (details && details.error) {
            // The error codes are listed in the Expo documentation:
            // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
            // You must handle the errors appropriately.
            console.error(`The error code is ${details.error}`);
          }
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
})();
