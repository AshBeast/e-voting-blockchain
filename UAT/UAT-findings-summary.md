# UAT Findings Summary

## Overview
- Test sessions completed: 5
- Total UAT cases executed: 50
- Passed: 49
- Failed: 1
- Overall pass rate: 98%

## Participants
- Shayan: technically advanced, completed all tasks successfully and quickly.
- Farzaneh: teacher, completed all tasks successfully but with a slower learning curve; the identity linking process felt unclear.
- Ali Reza: dentist, completed all tasks successfully but had difficulty with some terminology, readability, and wallet setup.
- Michael: biochemical engineering student, moved very quickly and completed all tasks except receipt verification because he lost the receipt after voting.
- Sarah: artist, initially mixed up the Semaphore and relayer addresses, but then completed all tasks successfully by carefully following the UI text.

## Main Findings
1. Core workflow functionality was strong.
   - All participants were able to complete the main election flow.
   - The only failed test case was Michael's receipt verification, caused by losing the receipt rather than a contract failure.
2. The largest issues were usability, not core logic.
   - The linking flow was not immediately intuitive for non-technical users.
   - Wallet setup remains too technical for some participants.
   - Some text, labels, and terminology need to be clearer and easier to read.
3. Receipt handling needs improvement.
   - The current flow allows users to move past the receipt too easily.
   - A stronger confirmation, copy/download step, or persistent receipt reminder would reduce failure risk.
4. Input labeling should be improved.
   - Address fields such as Semaphore address and relayer address can be confused.
   - Stronger inline descriptions and validation would help prevent this.
5. Fast users can skip important cues.
   - Important fields and messages need stronger visual emphasis so users do not overlook them when moving quickly.

## Issue Log Summary
- ISSUE-01: Identity linking flow is unclear for non-technical users.
- ISSUE-02: Wallet setup is too technical for broader adoption.
- ISSUE-03: Some text and terminology are hard to read or understand quickly.
- ISSUE-04: Receipt handling is too easy to miss, which can break later verification.
- ISSUE-05: Semaphore and relayer address fields are easy to confuse.
- ISSUE-06: Fast users can skip important text boxes or instructions.

## Recommended Next Actions
1. Simplify the linking page with shorter explanations and stronger step-by-step guidance.
2. Improve wallet-related onboarding or reduce manual wallet setup where possible.
3. Increase text clarity, readability, and consistency of terminology.
4. Redesign the receipt confirmation step so the receipt is harder to lose.
5. Add stronger labels and validation for admin address fields.
6. Highlight critical inputs and messages more strongly in kiosk and normal mode.

## Conclusion
The UAT results show that the current system is functionally usable and that the main election workflow works reliably. The most significant remaining problems are usability and clarity for less technical users, not failures in the core blockchain or zero-knowledge voting flow.
