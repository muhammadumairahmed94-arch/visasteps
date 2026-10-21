# Connecting the portal to Microsoft 365

There are two ways, depending on the Microsoft 365 plan:

- **Part P — Microsoft 365 Personal / Family** (current plan): files go to the owner's **OneDrive**, inside
  a folder Microsoft creates for the app: **OneDrive → Apps → UHA Legal Client Portal → Clients/…**.
  The portal can open **that folder only** (permission `Files.ReadWrite.AppFolder`), not the rest of the OneDrive.
- **Part B — Microsoft 365 Business**: files go to a firm-owned SharePoint site. Recommended once the firm moves to
  a Business plan; switching is a re-run of `npm run setup:onedrive`.

> **Compliance note (Part P).** Microsoft 365 Personal is licensed for personal use and its data location is not
> guaranteed to be the UK. The firm has chosen to accept this for now; it is recorded in the draft DPIA.

---

# Part P — Personal OneDrive (about 10 minutes)

Use the Microsoft account that has the Microsoft 365 Personal plan.

## P1. Open the Azure portal

1. Go to **https://portal.azure.com** and sign in with that Microsoft account.
2. If it offers a free trial or asks for a card: you do **not** need an Azure subscription. Close that page and
   search the top bar for **App registrations** instead.

## P2. Register the portal as an app

1. **App registrations** → **+ New registration**.
2. Name: **UHA Legal Client Portal** (this becomes the folder name: OneDrive → Apps → UHA Legal Client Portal).
3. Supported account types: **Personal Microsoft accounts only**.
4. Redirect URI: leave empty. Click **Register**.
5. On the **Overview** page copy the **Application (client) ID**. (Not secret.)

## P3. Allow sign-in from a terminal

1. In the app: **Authentication** (left menu).
2. Scroll to **Advanced settings** → **Allow public client flows** → **Yes** → **Save**.

## P4. Permissions

1. **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Tick **Files.ReadWrite.AppFolder** and **offline_access** → **Add permissions**.
3. You can remove **User.Read** if listed. No "admin consent" is needed — you approve it yourself in P5.

## P5. Connect the portal

In Terminal:

```bash
cd ~/Projects/visasteps && npm run setup:onedrive
```

1. Type **P** (Personal).
2. Paste the **Application (client) ID**.
3. It shows a web address and a short code. Open the address, type the code, sign in with the Microsoft account
   and press **Accept** (it lists "access to the app's folder in your OneDrive").
4. The command then tests everything (creates, uploads, reads, moves and deletes a test file in the app folder)
   and only saves if every check passes.

Then restart the portal (Ctrl+C in its terminal tab, `npm run dev`) and run `npm run onedrive:folders`.

**Staying connected.** The portal keeps a renewable sign-in (encrypted in the database) and refreshes it every few
days. If Microsoft ever asks for a fresh sign-in (for example after a password change), caseworkers see a banner,
uploads wait safely, and the owner just runs `npm run setup:onedrive` again.

---

# Part B — Microsoft 365 Business (SharePoint)

## B0. Check where the data is stored

The spec requires client data to stay in the UK/EU.

1. Go to **admin.microsoft.com** → **Settings** → **Org settings** → **Organization profile** tab → **Data location**.
2. It should say **United Kingdom** (or European Union).

If it shows another region (for example Asia Pacific), stop and tell your developer: the region is fixed when the
account is created, and this needs deciding before real client files are stored.

## B1. Create the "Client Files" SharePoint site

1. Go to **https://www.office.com** → app launcher (grid icon) → **SharePoint**.
2. **+ Create site** → **Team site** (or **Communication site**).
3. Name: **Client Files**. Check the site address ends in **/sites/ClientFiles**.
4. Privacy: **Private**. Add the caseworkers who should see client folders as members.
5. Open the new site and copy its address from the browser, e.g.
   `https://uhalegal.sharepoint.com/sites/ClientFiles` (your first part may differ). This is the **site address**.

The portal stores files in the site's standard **Documents** library, under `Clients/…`.

## B2. Register the portal as an app in Microsoft Entra

1. Go to **https://entra.microsoft.com** → **Identity** → **Applications** → **App registrations** → **+ New registration**.
2. Name: **UHA Legal Client Portal**.
3. Supported account types: **Accounts in this organizational directory only (single tenant)**.
4. Redirect URI: leave empty. Click **Register**.
5. On the app's **Overview** page, copy:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## B3. Create a client secret

1. In the app: **Certificates & secrets** → **Client secrets** → **+ New client secret**.
2. Description: **portal**. Expires: **12 months** (Microsoft's maximum recommendation).
3. Click **Add**, then immediately copy the **Value** column (not "Secret ID"). It is only shown once.
4. Put a reminder in the calendar ~11 months from today to create a new secret and run step 6 again.

## B4. Give the app the `Sites.Selected` permission

1. In the app: **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Application permissions**.
2. Search **Sites.Selected**, tick it, **Add permissions**.
3. If **User.Read** is listed, you can remove it (not needed).
4. Click **Grant admin consent for <your organisation>** → **Yes**. The status column should turn green.

`Sites.Selected` on its own gives access to **no** sites. Step 5 opens the one site.

## B5. Allow the app into the Client Files site only

This is done once, in Microsoft's Graph Explorer (a web page from Microsoft for running admin requests).

1. Go to **https://developer.microsoft.com/graph/graph-explorer** and **Sign in** (top right) as the Global Administrator.
2. Click your profile picture → **Consent to permissions**. Find **Sites.FullControl.All**, click **Consent**, accept.
   (This lets *you*, the admin, grant site access in the next steps. It does not give the portal anything.)
3. Find the site's ID. Set the method to **GET** and the address to (use your site address):

   ```
   https://graph.microsoft.com/v1.0/sites/uhalegal.sharepoint.com:/sites/ClientFiles
   ```

   Click **Run query**. In the response, copy the value of `"id"` — a long text with two commas in it.

4. Grant the portal write access. Set the method to **POST** and the address to (replace `SITE-ID`):

   ```
   https://graph.microsoft.com/v1.0/sites/SITE-ID/permissions
   ```

   In **Request body** paste (replace `CLIENT-ID` with the Application (client) ID from step 2):

   ```json
   {
     "roles": ["write"],
     "grantedToIdentities": [
       { "application": { "id": "CLIENT-ID", "displayName": "UHA Legal Client Portal" } }
     ]
   }
   ```

   Click **Run query**. Success is **201 Created** with `"roles": ["write"]` in the response.

5. Optional tidy-up: in **https://myapps.microsoft.com** or the Entra **Enterprise applications** list you can remove
   Graph Explorer's consent again. The grant you just made stays in place.

## B6. Connect the portal

On the computer running the portal, in Terminal:

```bash
cd ~/Projects/visasteps && npm run setup:onedrive
```

It asks for the four items above (the secret is hidden as you type), then checks everything with Microsoft:
signs in, finds the site, creates a test folder, uploads, reads back, moves and deletes a test file.
**Only if every check passes** does it save the details to `.env`.

Then restart the portal (Ctrl+C in its terminal, then `npm run dev`) and create the folders for existing clients:

```bash
npm run onedrive:folders
```

Run `npm run onedrive:check` at any time to re-test the connection.

## If something goes wrong

| Message | Fix |
|---|---|
| `invalid_client` / `AADSTS7000215` | The secret is wrong — copy the **Value**, not the Secret ID (step 3). Make a new one if unsure. |
| `AADSTS700016` / not found in the directory | Tenant ID or client ID mistyped — copy both again from the app's Overview page. |
| `403 accessDenied` | Step 5 not done, or done for a different site/app ID. Or admin consent missing (step 4). |
| `404` site not found | Site address wrong — open the site in a browser and copy its address. |
| Files show "Not in OneDrive yet" in the portal | Microsoft was unreachable. The portal retries by itself (1, 2, 4 … 60 minutes, 8 tries). Caseworkers can press **Retry now**. |

## How saving works (for reference)

- Each upload is renamed (`Khan_Passport_2026-10-18.pdf`) and saved to `Clients/Khan_Amina_IM-2041/01 Identity/`.
- Files are never overwritten; a clash gets `_2`, `_3`. Redone files move to `_Old versions/` in the same folder.
- If Microsoft does not answer, the file is kept **encrypted** on the portal server (`upload-queue/`) and retried.
  The encrypted copy is deleted as soon as Microsoft confirms the save. Nothing else is kept outside SharePoint.
- On hosts without a always-on server, schedule `GET /api/jobs/storage` every 5 minutes with header
  `Authorization: Bearer <CRON_SECRET>` (set `CRON_SECRET` in `.env`).
