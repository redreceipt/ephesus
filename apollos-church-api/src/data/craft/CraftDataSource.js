import { RESTDataSource } from 'apollo-datasource-rest';
import ApollosConfig from '@apollosproject/config';
import { ApolloError } from 'apollo-server';
import { createCursor, parseCursor } from '@apollosproject/server-core';
import { get } from 'lodash';
import Hypher from 'hypher';
import english from 'hyphenation.en-us';

export default class Craft extends RESTDataSource {
  baseURL = ApollosConfig.CRAFT.URL;

  willSendRequest = (request) => {
    request.headers.set('Authorization', ApollosConfig.CRAFT.GRAPH_TOKEN);
    request.headers.set('Content-Type', 'application/json');
  };

  // NOTE: Craft Integration
  query = (query, variables) =>
    this.post(
      '/',
      JSON.stringify({
        query,
        variables,
      })
    );

  entryFragment = `{
    id
    title
    typeId
    # series
    ... on series_series_Entry {
      seriesDescription
      hero {
        ... on hero_photoHero_BlockType {
          image {
            id
            url
          }
        }
      }
    }

    # stories
    ... on stories_stories_Entry {
      subtitle
      storyPortrait {
        url
      }
    }

    # studies
    ... on studies_curriculum_Entry {
      studySummary
      image {
        url
      }
    }

    # articles
    ... on articles_article_Entry {
      excerpt
      hero {
        ... on hero_photoHero_BlockType {
          image {
            url
          }
        }
      }
    }
  }`;

  // Override for: https://github.com/ApollosProject/apollos-apps/blob/master/packages/apollos-data-connector-rock/src/content-channels/resolver.js#L6
  // eslint-disable-next-line
  getRootChannels() {
    return [
      {
        id: 7, // Matches Entry.typeId, craft doesn't expose a query for this
        name: 'Series',
      },
      {
        id: 29,
        name: 'Stories',
      },
      {
        id: 43,
        name: 'Studies',
      },
      {
        id: 15,
        name: 'Articles',
      },
    ];
  }

  // Override for: https://github.com/ApollosProject/apollos-apps/blob/master/packages/apollos-data-connector-rock/src/content-channels/resolver.js#L13
  // eslint-disable-next-line
  byContentChannelId(typeId) {
    return { typeId };
  }

  // Override: https://github.com/ApollosProject/apollos-apps/blob/master/packages/apollos-data-connector-rock/src/content-channels/data-source.js#L46
  async getFromId(id) {
    const result = await this.query(
      `query ($id: [QueryArgument]) {
        entry(id: $id) ${this.entryFragment}
      }`,
      { id }
    );
    if (result?.error)
      throw new ApolloError(result?.error?.message, result?.error?.code);
    return result?.data?.entry;
  }

  // Override for: https://github.com/ApollosProject/apollos-apps/blob/master/packages/apollos-data-connector-rock/src/content-channels/resolver.js#L12
  async paginate(props) {
    const { cursor: filter, args: { after, first = 20 } = {} } = props;

    let cursor = {};
    if (after) {
      cursor = parseCursor(after);
      if (!cursor && typeof cursor !== 'object') {
        throw new Error(`An invalid 'after' cursor was provided: ${after}`);
      }
    }

    const variables = {
      limit: first,
      offset: 0,
      orderBy: 'dateCreated',
      inReverse: true,
      ...cursor,
      ...filter,
    };

    const result = await this.query(
      `query ($limit: Int, $offset: Int, $orderBy: String, $inReverse: Boolean, $typeId: [QueryArgument]) {
        entries(
          limit: $limit
          offset: $offset
          orderBy: $orderBy
          inReverse: $inReverse
          typeId: $typeId
        ) ${this.entryFragment}
      }`,
      variables
    );
    console.log(result);

    if (!result || result.error)
      throw new ApolloError(result?.error?.message, result?.error?.code);

    // Might need REST API to get count
    const getTotalCount = () => 100;

    // build the edges - translate series to { edges: [{ node, cursor }] } format
    const edges = (result?.data?.entries || []).map((node, i) => ({
      node,
      cursor: createCursor({
        ...variables,
        offset: variables.offset + i + 1,
      }),
    }));

    return {
      edges,
      getTotalCount,
    };
  }

  // ContentItem
  attributeIsImage = ({ key }) =>
    key.toLowerCase().includes('image') ||
    key.toLowerCase().includes('photo') ||
    key.toLowerCase().includes('img');

  attributeIsVideo = ({ key }) =>
    ['videoLink', 'wistiaVideo', 'storyVideo', 'videoEmbed'].includes(key);

  attributeIsAudio = ({ key, attributeValues }) =>
    attributeValues?.[key]?.value?.endsWith?.('.mp3');

  hasMedia = ({ attributeValues, attributes }) =>
    Object.keys(attributes).filter((key) =>
      this.attributeIsVideo({
        key,
        attributeValues,
        attributes,
      })
    ).length ||
    Object.keys(attributes).filter((key) =>
      this.attributeIsAudio({
        key,
        attributeValues,
        attributes,
      })
    ).length;

  getImages = ({ attributeValues, attributes }) => {
    const imageKeys = Object.keys(attributes).filter((key) =>
      this.attributeIsImage({
        key,
        attributeValues,
        attributes,
      })
    );
    return imageKeys.map((key) => ({
      __typename: 'ImageMedia',
      key,
      name: attributes[key].name,
      sources: attributeValues[key].value
        ? [{ uri: attributeValues[key].value }]
        : [],
    }));
  };

  getVideos = ({ attributeValues, attributes }) => {
    const videoKeys = Object.keys(attributes).filter((key) =>
      this.attributeIsVideo({
        key,
        attributeValues,
        attributes,
      })
    );
    return videoKeys.map((key) => ({
      __typename: 'VideoMedia',
      key,
      name: attributes[key].name,
      embedHtml: get(attributeValues, 'videoEmbed.value', null), // TODO: this assumes that the key `VideoEmbed` is always used on Rock
      sources: attributeValues[key].value
        ? [{ uri: attributeValues[key].value }]
        : [],
    }));
  };

  getAudios = ({ attributeValues, attributes }) => {
    const audioKeys = Object.keys(attributes).filter((key) =>
      this.attributeIsAudio({
        key,
        attributeValues,
        attributes,
      })
    );
    return audioKeys.map((key) => ({
      __typename: 'AudioMedia',
      key,
      name: attributes[key].name,
      sources: attributeValues[key].value
        ? [{ uri: attributeValues[key].value }]
        : [],
    }));
  };

  resolveType = () => 'UniversalContentItem';

  createSummary = (entry) => {
    switch (entry.typeId) {
      case 7: {
        // series
        return entry.seriesDescription; // HTML!
      }
      case 29: {
        // stories
        return entry.subtitle;
      }
      case 43: {
        // studies
        return entry.studySummary; // HTML!
      }
      case 15: {
        // articles
        return entry.excerpt;
      }
      default: {
        return '';
      }
    }
  };

  getCoverImage = (entry) => {
    switch (entry.typeId) {
      case 7: {
        // series
        return entry.hero?.image?.url;
      }
      case 29: {
        // stories
        return entry.storyPortrait?.url;
      }
      case 43: {
        // studies
        return entry.image?.url;
      }
      case 15: {
        // articles
        return entry.hero?.image?.url;
      }
      default: {
        return '';
      }
    }
  };

  // eslint-disable-next-line
  createHyphenatedString({ text }) {
    const hypher = new Hypher(english);
    const words = text.split(' ');

    /* We only want to hyphenate the end of words because Hyper uses a language dictionary to add
     * "soft" hyphens at the appropriate places. By only adding "soft" hyphens to the end of we
     * guarantee that words that can fit will and that words that can't fit don't wrap prematurely.
     * Essentially, meaning words will always take up the maximum amount of space they can and only
     * very very long words will wrap after the 7th character.
     *
     * Example:
     * Devotional can be hyphenated as "de-vo-tion-al." However, we hyphenate this word as
     * "devotion-al." This means that the word can always fit but usually return to a new line as
     * "devotional" rather than wrapping mid-word as "devo-tional". There are situations your mind
     * can create where this might a wrap at `devotion-al` but this is a worst worst case scenario
     * and in our tests was exceedingly rare in the English language.
     *
     * Additionally, The magic number below (7) is used here because our current
     * `HorizontalHighlighCard`s have a fixed width of 240px and 7 is the maximum number of capital
     * "W" characters that will fit with a hyphen in our current typography. While this is an
     * unlikely occurrence it represents the worst case scenario for word length.
     *
     * TODO: Expose the hyphenation point to make this more flexible in the future.
     */
    const hyphenateEndOfWord = (word, segment) =>
      word.length > 7 ? `${word}\u00AD${segment}` : word + segment;

    const hyphenateLongWords = (word, hyphenateFunction) =>
      word.length > 7 ? hyphenateFunction(word) : word;

    return words
      .map((w) =>
        hyphenateLongWords(w, () =>
          hypher.hyphenate(w).reduce(hyphenateEndOfWord)
        )
      )
      .join(' ');
  }
}
