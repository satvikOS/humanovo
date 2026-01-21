import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize } from 'react-icons/fi'
import { api, Entity } from '../services/api'

export default function KnowledgeGraph() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['entities', 'search', searchQuery],
    queryFn: () => api.searchEntities(searchQuery, { limit: 20 }),
    enabled: searchQuery.length >= 2,
  })

  const { data: neighborhood } = useQuery({
    queryKey: ['entity', 'neighborhood', selectedEntity?.id],
    queryFn: () => api.getEntityNeighbors(selectedEntity!.id, { depth: 1, limit: 50 }),
    enabled: !!selectedEntity,
  })

  const { data: stats } = useQuery({
    queryKey: ['knowledge', 'stats'],
    queryFn: () => api.getGraphStats(),
  })

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-secondary-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Knowledge Graph</h1>
            <p className="text-secondary-400 text-sm">
              Explore biomedical entities and relationships
            </p>
          </div>
          {stats && (
            <div className="flex space-x-6 text-sm">
              <div>
                <span className="text-secondary-400">Entities: </span>
                <span className="text-white font-medium">{stats.total_entities.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-secondary-400">Relations: </span>
                <span className="text-white font-medium">{stats.total_relations.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400 w-5 h-5" />
          <input
            type="text"
            className="input w-full pl-10"
            placeholder="Search entities (genes, proteins, diseases, drugs...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Search Results Dropdown */}
        {searchQuery.length >= 2 && searchResults && searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-w-2xl bg-secondary-800 border border-secondary-700 rounded-lg shadow-xl max-h-80 overflow-auto">
            {searchResults.map((entity) => (
              <button
                key={entity.id}
                className="w-full px-4 py-3 text-left hover:bg-secondary-700 transition-colors flex items-center justify-between"
                onClick={() => {
                  setSelectedEntity(entity)
                  setSearchQuery('')
                }}
              >
                <div>
                  <p className="text-white font-medium">{entity.name}</p>
                  <p className="text-secondary-400 text-sm">{entity.entity_type}</p>
                </div>
                <span className="badge badge-info text-xs">{entity.entity_type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Graph Visualization */}
        <div className="flex-1 relative bg-secondary-950" ref={containerRef}>
          {selectedEntity && neighborhood ? (
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Simple visualization placeholder */}
              <div className="text-center">
                <div className="w-24 h-24 mx-auto mb-4 bg-primary-600/30 rounded-full flex items-center justify-center border-2 border-primary-500">
                  <span className="text-white font-bold text-lg">{selectedEntity.name.slice(0, 3)}</span>
                </div>
                <h3 className="text-white font-semibold">{selectedEntity.name}</h3>
                <p className="text-secondary-400 text-sm">{selectedEntity.entity_type}</p>
                <p className="text-secondary-500 text-xs mt-2">
                  {neighborhood.entities.length} connected entities
                </p>
                <p className="text-secondary-500 text-xs">
                  {neighborhood.relations.length} relationships
                </p>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-secondary-500">
              Search for an entity to visualize its neighborhood
            </div>
          )}

          {/* Zoom Controls */}
          <div className="absolute bottom-4 right-4 flex flex-col space-y-2">
            <button className="p-2 bg-secondary-800 rounded-lg hover:bg-secondary-700 text-secondary-400 hover:text-white">
              <FiZoomIn className="w-5 h-5" />
            </button>
            <button className="p-2 bg-secondary-800 rounded-lg hover:bg-secondary-700 text-secondary-400 hover:text-white">
              <FiZoomOut className="w-5 h-5" />
            </button>
            <button className="p-2 bg-secondary-800 rounded-lg hover:bg-secondary-700 text-secondary-400 hover:text-white">
              <FiMaximize className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Details Panel */}
        {selectedEntity && (
          <div className="w-80 border-l border-secondary-700 p-4 overflow-auto">
            <h2 className="text-lg font-semibold text-white mb-4">Entity Details</h2>

            <div className="space-y-4">
              <div>
                <label className="text-secondary-400 text-sm">Name</label>
                <p className="text-white">{selectedEntity.name}</p>
              </div>

              <div>
                <label className="text-secondary-400 text-sm">Type</label>
                <p className="text-white">{selectedEntity.entity_type}</p>
              </div>

              {selectedEntity.description && (
                <div>
                  <label className="text-secondary-400 text-sm">Description</label>
                  <p className="text-secondary-300 text-sm">{selectedEntity.description}</p>
                </div>
              )}

              {selectedEntity.aliases && selectedEntity.aliases.length > 0 && (
                <div>
                  <label className="text-secondary-400 text-sm">Aliases</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedEntity.aliases.map((alias, i) => (
                      <span key={i} className="badge badge-info text-xs">{alias}</span>
                    ))}
                  </div>
                </div>
              )}

              {neighborhood && neighborhood.relations.length > 0 && (
                <div>
                  <label className="text-secondary-400 text-sm mb-2 block">
                    Relationships ({neighborhood.relations.length})
                  </label>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {neighborhood.relations.slice(0, 20).map((rel, i) => (
                      <div key={i} className="p-2 bg-secondary-800 rounded text-sm">
                        <span className="text-primary-400">{rel.source_name}</span>
                        <span className="text-secondary-400 mx-2">{rel.relation_type}</span>
                        <span className="text-primary-400">{rel.target_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
