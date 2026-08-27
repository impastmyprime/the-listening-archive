/* Dynamic ME / YOU perspective helpers. */

/* Dynamic ME / YOU perspective */
    function getDisplayNames() {
      if (currentPerson === "friend") {
        return {
          me: ARCHIVE_PEOPLE.friend,
          you: ARCHIVE_PEOPLE.owner
        };
      }

      return {
        me: ARCHIVE_PEOPLE.owner,
        you: ARCHIVE_PEOPLE.friend
      };
    }

    function getDisplaySender(person) {
      const names = getDisplayNames();
      return person === currentPerson ? names.me : names.you;
    }
