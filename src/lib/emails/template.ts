import { env } from 'cloudflare:workers';
import { styleConfig } from '../config';

/**
 * Port of TemplateManager + the Alert.html template. Only the "Alert" template
 * is ported - it's the only one used by the front-end's emails. (The daily
 * new-album emails are rendered on the NAS, which keeps its own copy.)
 */

const EMAIL_FONT_FAMILY = "font-family: 'Helvetica Neue',Helvetica,Arial,sans-serif;";
const EMAIL_ROW_HTML = `<tr style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;">`;
const BODY_CELL_HTML =
	`<td class="content-block" style="${EMAIL_FONT_FAMILY} box-sizing: border-box;` +
	'font-size: 14px; vertical-align: top; margin: 0; padding: 0 0 20px; text-align: center;" align="center" valign="top">';
const FOOTER_CELL_HTML =
	`<td class="aligncenter content-block" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 12px; vertical-align: top; ` +
	'color: #999; text-align: center; margin: 0; padding: 0;" align="center" valign="top">';

export interface BodyParagraph {
	htmlText: string;
	buttonUrl?: string;
}

export interface FooterLine {
	htmlText: string;
}

/** Port of TemplateManager.GetEmailLink */
export function getEmailLink(url: string, text: string, colour?: string, fontSize = '14px'): string {
	const linkColour = colour || styleConfig.primaryColour;
	const target = url.startsWith('mailto:') ? '_self' : '_blank';

	return (
		`<a href="${url}" target="${target}" rel="noopener" style="${EMAIL_FONT_FAMILY} ` +
		`font-size: ${fontSize}; color: ${linkColour}; text-decoration: underline; margin: 0; box-sizing: border-box; ">${text}</a>`
	);
}

/** Port of TemplateManager.GetEmailTextFooter */
export function getEmailTextFooter(): string {
	const { appName, frontendRootUrl } = getAppSettings();
	return `\r\n\r\n\r\n----------------Sent by ${appName}\r\n${frontendRootUrl}`;
}

function getAppSettings() {
	return { appName: env.APP_NAME, frontendRootUrl: (env.FRONTEND_ROOT_URL ?? '').replace(/\/+$/, '') };
}

function renderButton(htmlText: string, buttonUrl: string): string {
	const { primaryColour, textColourOnPrimary } = styleConfig;
	return (
		`<a href="${buttonUrl}" target="_blank" rel="noopener" class="btn-primary" style="font-family: 'Helvetica Neue',Helvetica,Arial,sans-serif; ` +
		`box-sizing: border-box; font-size: 14px; color: ${textColourOnPrimary}; text-decoration: none; line-height: 2em; font-weight: bold; ` +
		`text-align: center; cursor: pointer; display: inline-block; border-radius: 5px; background-color: ${primaryColour}; ` +
		`margin: 0; border-color: ${primaryColour}; border-style: solid; border-width: 10px 20px;">${htmlText}</a>`
	);
}

function renderFooter(providedLines: FooterLine[]): string {
	const { frontendRootUrl } = getAppSettings();
	const spotifyLogoUrl = `${frontendRootUrl}/images/spotify-logo-white.png`;

	let footerHtml = '';
	for (const line of providedLines) {
		footerHtml += `${EMAIL_ROW_HTML}${FOOTER_CELL_HTML}${line.htmlText}</td></tr>`;
	}
	//Generic lines appended to all emails, ported from TemplateManager
	footerHtml += `${EMAIL_ROW_HTML}${FOOTER_CELL_HTML}${getEmailLink(frontendRootUrl, frontendRootUrl, undefined, '12px')}</td></tr>`;
	footerHtml += `${EMAIL_ROW_HTML}${FOOTER_CELL_HTML}Artist and album content including cover art supplied by:</td></tr>`;
	footerHtml +=
		`${EMAIL_ROW_HTML}${FOOTER_CELL_HTML}<img alt="Spotify logo" src="${spotifyLogoUrl}" width="80" height="24" style="width: 80px; height: 24px; margin: 0; outline: none;" /></td></tr>`;

	return footerHtml;
}

/** Port of TemplateManager.GetHtmlEmailTemplate(TemplateTypes.Alert) */
export function renderAlertEmail(input: { heading: string; bodyParagraphs: BodyParagraph[]; footerLines?: FooterLine[] }): string {
	const { primaryColour, backgroundColour } = styleConfig;
	const { frontendRootUrl } = getAppSettings();

	let bodyHtml = '';
	for (const paragraph of input.bodyParagraphs) {
		bodyHtml += `${EMAIL_ROW_HTML}${BODY_CELL_HTML}`;
		if (paragraph.buttonUrl) {
			bodyHtml += renderButton(paragraph.htmlText, paragraph.buttonUrl);
		} else {
			bodyHtml += paragraph.htmlText;
		}
		bodyHtml += '</td></tr>';
	}

	const footerHtml = renderFooter(input.footerLines ?? []);

	//Ported verbatim from Alert.html
	return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;">
<head>
<meta name="viewport" content="width=device-width" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>${input.heading}</title>

<style type="text/css">
img {
max-width: 100%;
}
body {
-webkit-font-smoothing: antialiased; -webkit-text-size-adjust: none; width: 100% !important; height: 100%; line-height: 1.6em;
}
body {
background-color: ${backgroundColour};
}
@media only screen and (max-width: 640px) {
  body {
    padding: 0 !important;
  }
  h1 {
    font-weight: 800 !important; margin: 20px 0 5px !important;
  }
  h2 {
    font-weight: 800 !important; margin: 20px 0 5px !important;
  }
  h3 {
    font-weight: 800 !important; margin: 20px 0 5px !important;
  }
  h4 {
    font-weight: 800 !important; margin: 20px 0 5px !important;
  }
  h1 {
    font-size: 22px !important;
  }
  h2 {
    font-size: 18px !important;
  }
  h3 {
    font-size: 16px !important;
  }
  .container {
    padding: 0 !important; width: 100% !important;
  }
  .content {
    padding: 0 !important;
  }
  .content-wrap {
    padding: 10px !important;
  }
}
</style>
</head>

<body itemscope itemtype="http://schema.org/EmailMessage" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: none; width: 100% !important; height: 100%; line-height: 1.6em; background-color: ${backgroundColour}; margin: 0;" bgcolor="${backgroundColour}">

<table class="body-wrap" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; width: 100%; background-color: ${backgroundColour}; margin: 0;" bgcolor="${backgroundColour}"><tr style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;"><td style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0;" valign="top"></td>
		<td class="container" width="600" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; vertical-align: top; display: block !important; max-width: 600px !important; clear: both !important; margin: 0 auto;" valign="top">
			<div class="content" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; max-width: 600px; display: block; margin: 0 auto; padding: 20px;">
				<table class="main" width="100%" cellpadding="0" cellspacing="0" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; border-radius: 3px; background-color: #fff; margin: 0; border: 1px solid #e9e9e9;" bgcolor="#fff"><tr style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;"><td class="alert alert-warning" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 16px; vertical-align: top; color: #fff; font-weight: 500; text-align: center; border-radius: 3px 3px 0 0; background-color: ${primaryColour}; margin: 0; padding: 20px;" align="center" bgcolor="${primaryColour}" valign="top">
                            <img src="${frontendRootUrl}/images/icon.png" alt="New Albums via Email" width="80" height="80" style="width: 80px; height: 80px;" />
                        </td>
                    </tr><tr style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;"><td class="alert alert-warning" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 16px; vertical-align: top; color: #fff; font-weight: bold; text-align: center; border-radius: 0; background-color: ${primaryColour}; margin: 0; padding: 0 20px 20px 20px;" align="center" bgcolor="${primaryColour}" valign="top">
							${input.heading}
						</td>
					</tr><tr style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;"><td class="content-wrap" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0; padding: 20px;" valign="top">
							<table width="100%" cellpadding="0" cellspacing="0" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; margin: 0;">${bodyHtml}</table></td>
					</tr></table><div class="footer" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; width: 100%; clear: both; color: #999; margin: 0; padding: 20px;">
					<table width="100%" style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; line-height: 1.3em; margin: 0;">${footerHtml}</table></div></div>
		</td>
		<td style="${EMAIL_FONT_FAMILY} box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0;" valign="top"></td>
	</tr></table></body>
</html>`;
}
