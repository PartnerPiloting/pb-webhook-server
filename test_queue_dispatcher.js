// test_queue_dispatcher.js
console.log("<<<<< TEST_QUEUE_DISPATCHER.JS - LOADED - Version D >>>>>");

module.exports = function mountTestDispatcher(app) {
    console.log("<<<<< TEST_QUEUE_DISPATCHER.JS - mountTestDispatcher function CALLED >>>>>");
    if (app && typeof app.post === 'function') {
        console.log("App object was received by mountTestDispatcher.");
    } else {
        console.warn("App object was NOT what was expected in mountTestDispatcher.");
    }
};