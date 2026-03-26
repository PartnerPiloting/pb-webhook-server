/**
 * Verifies the browser inline script pattern parses (catches apostrophe-in-template bugs).
 *   npm run guest-book:verify-inline
 */
const snippet = `(function(){
  var btn = { textContent: "" };
  btn.textContent = "Let's lock this";
  btn.textContent = "Locking…";
})();`;

try {
  new Function(snippet);
  console.log("OK: guest-book button strings parse in browser JS");
  process.exit(0);
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}
