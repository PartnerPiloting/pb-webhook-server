# React Debugging Checklist

Use this checklist whenever you start a new debugging session or chat about a React bug. It will help you catch the most common issues quickly, especially with props, state, and rendering.

---

## 1. Check Component Props
- [ ] Is the component expecting any props? (Look for function parameters or PropTypes)
- [ ] Is the parent actually passing those props? (Check the parent's JSX)
- [ ] If a prop is missing, add it—even if it's just an empty array or object for now.
- [ ] If the prop is required, use `PropTypes.isRequired` to get a warning if it's missing.

## 2. Check Default Values
- [ ] Does the component set a default value for props? (e.g., `({ leads = [] })`)
- [ ] Are you relying on the default, or should the parent always provide the prop?

## 3. Check State and Data Loading
- [ ] If the component fetches data, is the data loaded before it's used?
- [ ] Are you checking for `undefined` or `null` before using data (e.g., before calling `.map` or `.filter`)?

## 4. Check for Console Warnings/Errors
- [ ] Open the browser console and look for warnings or errors.
- [ ] Read the full error message—it often tells you exactly what's wrong (e.g., "Cannot read property 'filter' of undefined").

## 5. Check Component Usage
- [ ] Is the component being used in more than one place? (Check all usages)
- [ ] Are all usages passing the required props?

## 6. Add Temporary Console Logs
- [ ] Add `console.log` statements to print out props and state at the top of your component.
- [ ] This helps you see what's actually being passed in at runtime.

## 7. If Stuck, Ask for Help
- [ ] Share the checklist and what you've checked so far with your assistant or developer.
- [ ] Provide the error message and the relevant code (component and parent usage).

---

**Tip:** Most React bugs are caused by missing or misused props, uninitialized state, or data not being loaded yet. This checklist will help you catch those fast! 