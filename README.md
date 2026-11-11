# CBMW_Walk_Manager
3 Link Apps to Builds the CBMW Seasonal Walking Programme

The rules are the locks on the database, and they decide what each kind of person can see and change.

Anyone visiting the site (walkers, not signed in)

Can read the walk list, walk details, and the booked slots on the calendar, including which leader is on each booking.
Can’t see leaders’ email addresses or phone numbers in the list. Contact details are only shown on a booking, through a private code, so they can’t be browsed.
Can’t change anything.

Leaders (signed in with their own email and password)

Can see the names of all leaders, but only their own full record, including their contact details.
Can see who owns each walk.
Can take ownership of a walk that has no owner, and ask for changes only on walks they own.
Can book walks they own, or walks they are listed as permitted to lead, and only as one of the first two leaders on a booking.
Can see only their own change requests.
Can post messages on any walk.
Can’t see or change other leaders’ records or their requests.

Admins (signed in, with admin rights set)

Can see and change everything: all walks, bookings, leaders, contact details, requests and sign-ins.
Can give or take away admin rights and sign-ins from the Leaders app. The app stops anyone removing the last admin, so the club can’t lock itself out.
Can see which leaders are admins.

Things the rules don’t do alone

The last-admin check and the confirmation before removing an admin are in the Leaders app, not in the database rules.
Deleting an account from the sign-in list has to be done in the Firebase console, because the apps can’t delete accounts.
The very first admin is still set by hand in the Firebase console.
